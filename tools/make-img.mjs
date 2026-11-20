// Draws the article's diagrams as plain SVG files (no dependencies). Run: node tools/make-img.mjs
import { writeFileSync } from "node:fs";
const C = { bg: "#fbfaf6", ink: "#1c2430", mut: "#5b6675", line: "#c9cfd8", teal: "#0f766e", tealBg: "#d9f2ee", gold: "#b7791f", goldBg: "#fbefd2", red: "#b42318", redBg: "#fde4e1", blue: "#1d4ed8", blueBg: "#dfe8fd", grey: "#eef0f3" };
const F = `font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"`;
const M = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"`;
const svg = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}">
<title>${title}</title>
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.mut}"/></marker></defs>
<rect width="${w}" height="${h}" rx="14" fill="${C.bg}" stroke="${C.line}"/>
${body}
</svg>
`;
const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" ${o.mono ? M : F} font-size="${o.size ?? 14}" font-weight="${o.w ?? 400}" fill="${o.fill ?? C.ink}" text-anchor="${o.a ?? "start"}">${s}</text>`;
const box = (x, y, w, h, fill, stroke, r = 10) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
const arrow = (x1, y1, x2, y2, o = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.c ?? C.mut}" stroke-width="${o.sw ?? 1.5}" ${o.dash ? 'stroke-dasharray="5 4"' : ""} marker-end="url(#a)"/>`;

// 1. Two halves
{
  const w = 860, h = 330;
  let b = t(30, 40, "Two halves of one number", { size: 20, w: 700 });
  b += t(30, 64, "Neither side holds both halves early enough to steer the result.", { fill: C.mut });
  b += box(30, 90, 370, 130, C.tealBg, C.teal) + t(50, 120, "HALF 1 — the round secret", { w: 700, fill: C.teal, size: 13 });
  b += t(50, 148, "Known to: the operator only") + t(50, 172, "Fixed: before the bet — its Merkle root") + t(50, 192, "is already stored in the program");
  b += box(460, 90, 370, 130, C.goldBg, C.gold) + t(480, 120, "HALF 2 — hash of the bet's block", { w: 700, fill: C.gold, size: 13 });
  b += t(480, 148, "Known to: nobody — the block") + t(480, 168, "does not exist yet") + t(480, 192, "Fixed: when the network closes the block");
  b += arrow(215, 220, 380, 262) + arrow(645, 220, 480, 262);
  b += box(250, 250, 360, 54, "#fff", C.ink) + t(430, 274, "round value =", { a: "middle", size: 13, fill: C.mut }) + t(430, 293, "SHA-256(label, secret, block hash)", { a: "middle", mono: true, size: 13, w: 600 });
  writeFileSync("img/two-halves.svg", svg(w, h, "The round value is made of two halves: the operator's committed secret and the hash of the bet's block", b));
}
// 2. Timeline
{
  const w = 860, h = 300, y = 150, xs = [80, 255, 430, 605, 780];
  const lab = [["1", "Commit", "operator writes the", "Merkle root on-chain"], ["2", "Bet", "your transaction gets", "the next secret number"], ["3", "Block closes", "its hash becomes", "the second half"], ["4", "Reveal", "operator publishes the", "secret and its proof"], ["5", "Settle", "program checks the proof", "and pays in the same step"]];
  let b = t(30, 40, "Life of one round", { size: 20, w: 700 }) + t(30, 64, "Steps 4 and 5 are one transaction, normally a few seconds after the bet.", { fill: C.mut });
  b += `<line x1="${xs[0]}" y1="${y}" x2="${xs[4]}" y2="${y}" stroke="${C.line}" stroke-width="3"/>`;
  xs.forEach((x, i) => {
    const col = i === 0 ? C.teal : i === 2 ? C.gold : C.ink;
    b += `<circle cx="${x}" cy="${y}" r="17" fill="${col}"/>` + t(x, y + 5, lab[i][0], { a: "middle", fill: "#fff", w: 700 });
    b += t(x, y - 34, lab[i][1], { a: "middle", w: 700 }) + t(x, y + 46, lab[i][2], { a: "middle", size: 12, fill: C.mut }) + t(x, y + 62, lab[i][3], { a: "middle", size: 12, fill: C.mut });
  });
  b += `<path d="M${xs[0]} ${y + 84} v14 H${xs[3]} v-14" fill="none" stroke="${C.teal}" stroke-dasharray="5 4" stroke-width="1.5"/>` + t((xs[0] + xs[3]) / 2, y + 118, "the secret revealed at step 4 must lead to the root written at step 1", { a: "middle", size: 12.5, fill: C.teal, w: 600 });
  writeFileSync("img/timeline.svg", svg(w, h, "Timeline of a round: commit, bet, block closes, reveal, settle", b));
}
// 3. Merkle path (8 leaves shown)
{
  const w = 860, h = 420;
  let b = t(30, 40, "One short hash commits to a million secrets", { size: 20, w: 700 }) + t(30, 64, "To prove one leaf belongs to the root you need only its siblings on the way up — the gold boxes.", { fill: C.mut });
  const lv = [[430], [230, 630], [130, 330, 530, 730], [80, 180, 280, 380, 480, 580, 680, 780]], ys = [110, 190, 270, 350];
  const path = new Set(["3-1", "2-0", "1-0", "0-0"]), sib = new Set(["3-0", "2-1", "1-1"]);
  for (let L = 0; L < 3; L++) lv[L].forEach((x, i) => { for (const k of [0, 1]) { const cx = lv[L + 1][i * 2 + k], on = path.has(`${L + 1}-${i * 2 + k}`) && path.has(`${L}-${i}`); b += `<line x1="${x}" y1="${ys[L] + 18}" x2="${cx}" y2="${ys[L + 1] - 18}" stroke="${on ? C.teal : C.line}" stroke-width="${on ? 3 : 1.5}"/>`; } });
  lv.forEach((row, L) => row.forEach((x, i) => {
    const k = `${L}-${i}`, isP = path.has(k), isS = sib.has(k), ww = L === 0 ? 120 : L === 3 ? 76 : 96;
    b += box(x - ww / 2, ys[L] - 18, ww, 36, isP ? C.tealBg : isS ? C.goldBg : C.grey, isP ? C.teal : isS ? C.gold : C.line, 8);
    b += t(x, ys[L] + 5, L === 0 ? "ROOT" : L === 3 ? `secret ${i}` : "hash", { a: "middle", size: 12.5, w: isP || L === 0 ? 700 : 400, fill: isP ? C.teal : isS ? C.gold : C.mut });
  }));
  b += t(430, 86, "stored in the program before any bet", { a: "middle", size: 12, fill: C.teal });
  b += t(30, 398, "Green: your secret and the hashes computed from it.   Gold: the proof — three hashes here, twenty in a tree of 1,048,576 secrets.", { size: 12.5, fill: C.mut });
  writeFileSync("img/merkle-path.svg", svg(w, h, "A Merkle tree: the revealed secret and three sibling hashes are enough to recompute the root", b));
}
// 4. What happens if the operator does nothing
{
  const w = 860, h = 310;
  let b = t(30, 40, "What happens if the operator does not settle", { size: 20, w: 700 }) + t(30, 64, "Time since the bet. Limits are counted in network slots; minutes are approximate.", { fill: C.mut });
  const x0 = 40, x1 = 820, y = 150;
  const seg = [[0, .2, C.tealBg, C.teal, "seconds", "normal settlement"], [.2, .46, C.goldBg, C.gold, "up to ~20 min", "settles, with jackpots"], [.46, .74, C.blueBg, C.blue, "after ~20 min", "settles, WITHOUT jackpots"], [.74, 1, C.redBg, C.red, "~24 hours, sealed", "stake refunded in full"]];
  seg.forEach(([a, z, f, s, l1, l2]) => { const xa = x0 + (x1 - x0) * a, ww = (x1 - x0) * (z - a); b += box(xa, y - 26, ww - 4, 52, f, s, 8) + t(xa + ww / 2, y - 3, l1, { a: "middle", size: 12.5, w: 700, fill: s }) + t(xa + ww / 2, y + 15, l2, { a: "middle", size: 12, fill: C.ink }); });
  b += box(x0, 214, 520, 62, "#fff", C.line) + t(x0 + 16, 238, "Round never sealed and not settled within ~4–5 minutes:", { size: 13, w: 700 }) + t(x0 + 16, 260, "anyone may close it — the stake is refunded in full.", { size: 13 });
  b += box(580, 214, 240, 62, "#fff", C.line) + t(596, 238, "Every refund adds one to a", { size: 13 }) + t(596, 260, "public counter in the program.", { size: 13 });
  writeFileSync("img/timeouts.svg", svg(w, h, "Timeouts: normal settlement in seconds, no jackpots after about 20 minutes, full refund if the secret is never revealed", b));
}
// 5. Where a stake goes
{
  const w = 860, h = 250;
  let b = t(30, 40, "Where an average stake goes (program version 2)", { size: 20, w: 700 }) + t(30, 64, "Computed from the program's prize tables and shares. The same split applies to every game.", { fill: C.mut });
  const parts = [[87.67, C.teal, C.tealBg, "87.67%", "prizes (incl. free re-spins)"], [5.01, C.gold, C.goldBg, "5.01%", "jackpots"], [0.33, C.blue, C.blueBg, "0.33%", "prize bank, then jackpots"], [6.99, C.red, C.redBg, "6.99%", "project"]];
  let x = 40; const W = 780;
  parts.forEach(([p, s, f, l]) => { const ww = Math.max(W * p / 100, 6); b += `<rect x="${x}" y="96" width="${ww}" height="54" fill="${f}" stroke="${s}" stroke-width="1.5"/>`; if (p > 5) b += t(x + ww / 2, 129, l, { a: "middle", w: 700, fill: s, size: 16 }); x += ww; });
  let lx = 40; parts.forEach(([p, s, f, l, name]) => { b += `<rect x="${lx}" y="178" width="14" height="14" rx="3" fill="${f}" stroke="${s}"/>` + t(lx + 22, 190, `${l} ${name}`, { size: 13 }); lx += name.length * 7.2 + 90; });
  b += t(40, 226, "About 93% returns to players on average. Version 1 (before upgrade No. 2): 87.67 / 2 / 0.33 / 10, about 90%.", { size: 13, fill: C.mut });
  writeFileSync("img/stake-split.svg", svg(w, h, "Split of an average stake in program version 2: 87.67 percent prizes, 5.01 percent jackpots, 0.33 percent prize bank and from there jackpots, 6.99 percent project", b));
}
// 6. Proven / not proven
{
  const w = 860, h = 330;
  let b = t(30, 40, "What the check proves — and what it does not", { size: 20, w: 700 });
  b += box(30, 62, 390, 240, C.tealBg, C.teal) + t(50, 92, "YOU CAN VERIFY", { w: 700, fill: C.teal, size: 13 });
  ["the secret was fixed before your bet", "the secret is the one committed for your", "   round number, not a neighbour's", "the round value follows from the secret", "   and the block hash", "a refund happened when a round was", "   not settled (public counter)"].forEach((s, i) => (b += t(50, 122 + i * 24, (s.startsWith(" ") ? "" : "✓ ") + s.trim(), { size: 13.5 })));
  b += box(440, 62, 390, 240, C.redBg, C.red) + t(460, 92, "THE CHECK DOES NOT COVER", { w: 700, fill: C.red, size: 13 });
  ["the house share (about 7%; 10% in version 1)", "whether a game is a good idea for you", "future versions of the program", "   (upgrades are visible in an explorer)", "whether the published source has", "   mistakes: no external audit"].forEach((s, i) => (b += t(460, 122 + i * 24, (s.startsWith(" ") ? "" : "✗ ") + s.trim(), { size: 13.5 })));
  writeFileSync("img/proves.svg", svg(w, h, "What the round check proves and what it does not cover", b));
}
console.log("ok");
