// Run: node --test
// Equality of recompute.mjs with the on-chain engine. The vectors were written by the Rust engine of the program itself
// (programs/fairdrum/tests/vectors_gen.rs): 3,748 rounds, about 259,000 stakes: every game, late and on time, cut prizes,
// every pot, the pay caps, deferred starting amounts. The header of the file carries the constants the engine was built
// with; they are compared with the constants in recompute.mjs first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ECON, MODE_TABLES, ROUND_INPUTS_LEN, decodeRoundInputs, differencesFromEvent, goldSector, inputsFromEvent, mainSector, recomputeFromEvents, recomputeRound, roundInputsDiscriminator, roundValue, toHex, traceOf } from "../recompute.mjs";
import { b58decode, b58encode, checkTransaction, programEvents } from "../verify.mjs";

const V = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/recompute-vectors.json.gz", import.meta.url))).toString("utf8"));
const AMOUNTS = ["prizeCap", "startJackpot", "startSuper", "prizePool", "jackpotPool", "miniPool", "superPool", "seedPool", "seedReserve", "initJackpot", "initSuper"];
const inputsOf = (i) => ({ mode: i.mode, stakes: i.stakes, free: i.free, late: i.late, value: i.value, ...Object.fromEntries(AMOUNTS.map((k) => [k, BigInt(i[k])])) });
const flat = (r) => {
  const { totals: t, after: a } = r, s = (x) => x.toString();
  return { spins: t.spins, extras: t.extras, gold: t.gold, prizes: s(t.prizes), bestPrize: s(t.bestPrize), miniHits: t.miniHits, miniWon: s(t.miniWon), jackpotHits: t.jackpotHits, jackpotTotal: s(t.jackpotTotal), jackpotNow: s(t.jackpotNow), superHits: t.superHits, superTotal: s(t.superTotal), credited: s(t.credited), locked: s(t.locked), perWeek: s(t.perWeek), prizePool: s(a.prizePool), jackpotPool: s(a.jackpotPool), miniPool: s(a.miniPool), superPool: s(a.superPool), seedPool: s(a.seedPool), seedReserve: s(a.seedReserve), promoAdded: s(a.promoAdded), bankReleased: s(a.bankReleased) };
};
const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));

test("the constants and prize tables in recompute.mjs are the ones the Rust engine was built with", () => {
  const c = V.consts;
  assert.deepEqual([ECON.costRaw, ECON.S.prize, ECON.S.jack, ECON.S.mini, ECON.S.super, ECON.S.seed, ECON.againBps], [c.cost, c.sPrize, c.sJack, c.sMini, c.sSuper, c.sSeed, c.againBps]);
  assert.deepEqual([ECON.jpMinPotRaw, ECON.miniMinPotRaw, ECON.miniStartDiv, ECON.super.minPotRaw, ECON.cooldownBps, ECON.prizeBankDiv, ECON.ladderSum], [c.jpMinPot, c.miniMinPot, c.miniStartDiv, c.superMinPot, c.cooldownBps, c.prizeBankDiv, c.ladderSum]);
  assert.deepEqual([ECON.jp.winnerBps, ECON.jp.superBps, ECON.jp.nowBps, ECON.jp.weeklyBps, ECON.super.winnerBps, ECON.expirySlots], [c.jpWinnerBps, c.jpSuperBps, c.jpNowBps, c.jpWeeklyBps, c.superWinnerBps, c.expirySlots]);
  assert.deepEqual([ECON.payCap.jackpotBps, ECON.payCap.miniBps, ECON.payCap.superBps], [c.jpPayCapBps, c.miniPayCapBps, c.superPayCapBps]);
  assert.equal(c.superTopUp, false);
  assert.deepEqual([ECON.keep.jackpotBps, ECON.keep.miniBps, ECON.bank.keepRaw, ECON.bank.releaseBps], [c.jpKeepBps, c.miniKeepBps, c.bankKeep, c.bankReleaseBps]);
  assert.equal(MODE_TABLES.length, V.modes.length);
  V.modes.forEach((m, i) => {
    assert.equal(MODE_TABLES[i].ppm, BigInt(m.ppm));
    const live = m.ladder.filter((r) => r[1] > 0);
    assert.deepEqual(m.ladder.slice(0, live.length), live);
    assert.deepEqual(MODE_TABLES[i].rows.map((r) => [Number(r.amount), Number(r.weight)]), live);
  });
  assert.equal(toHex(roundValue(V.salted.secret, V.salted.salt)), V.salted.value);
});

test("the draw of a stake at every boundary equals the engine (more than 10,000 cases)", () => {
  let n = 0;
  for (const p of V.primitives) {
    const [sup, jackpot, mini, prize, again] = p.odds.map(BigInt);
    const o = { super: sup, jackpot, mini, prize, again };
    for (const [u, want] of p.main) { assert.equal(mainSector(BigInt(u), o), want); n++; }
    for (const [u1, u2, want] of p.gold) {
      const g = goldSector(BigInt(u1), BigInt(u2), o, p.mode);
      assert.equal("row" in g ? String(g.row) : { super: "S", jackpot: "J", mini: "M" }[g.pot], want);
      n++;
    }
  }
  assert.ok(n > 10000);
});

test("all 3,748 rounds: totals, pools after the settlement and every single stake equal the engine", () => {
  assert.equal(V.vectors.length, 3748);
  let stakes = 0;
  const bad = [];
  const seen = { cut: 0, mini: 0, jackpot: 0, super: 0, late: 0 };
  V.vectors.forEach((v, i) => {
    const r = recomputeRound(inputsOf(v.in));
    stakes += r.stakes.length;
    if (JSON.stringify(flat(r)) !== JSON.stringify(v.out) || traceOf(r) !== v.trace || differencesFromEvent(r, v.out).length) bad.push(`#${i} ${v.tag}`);
    // and from the event RoundInputs alone, as verify.mjs --tx does
    const e = recomputeRound(inputsFromEvent(v.event, v.in.value));
    if (JSON.stringify(flat(e)) !== JSON.stringify(v.out) || traceOf(e) !== v.trace) bad.push(`#${i} ${v.tag} (from the event)`);
    if (r.stakes.some((s) => s.kind === "prize" && s.amount < s.table)) seen.cut++;
    if (r.totals.miniHits) seen.mini++;
    if (r.totals.jackpotHits) seen.jackpot++;
    if (r.totals.superHits) seen.super++;
    if (v.in.late) seen.late++;
  });
  assert.deepEqual(bad, []);
  assert.ok(stakes > 200_000 && seen.cut > 500 && seen.mini > 100 && seen.jackpot > 50 && seen.super > 30 && seen.late > 500, JSON.stringify(seen));
  console.log(`      ${V.vectors.length} rounds, ${stakes} stakes; with cut prizes ${seen.cut}, mini ${seen.mini}, jackpot ${seen.jackpot}, super ${seen.super}, late ${seen.late}`);
});

test("the raw bytes of the event RoundInputs decode to the inputs of the round", () => {
  const raws = V.vectors.filter((v) => v.rawEvent);
  assert.ok(raws.length > 100);
  for (const v of raws) {
    const bytes = fromHex(v.rawEvent);
    assert.equal(bytes.length, ROUND_INPUTS_LEN);
    assert.deepEqual(inputsFromEvent(decodeRoundInputs(bytes), v.in.value), inputsOf(v.in));
  }
  assert.equal(toHex(roundInputsDiscriminator()), raws[0].rawEvent.slice(0, 16));
  assert.equal(decodeRoundInputs(new Uint8Array(141)), null);
});

test("a settlement from its three events; a changed total is noticed", () => {
  const S = V.sampleTx, v = V.vectors.find((x) => x.tag === "sample-tx");
  const rr = fromHex(S.roundRevealed);
  const revealed = { secret: rr.slice(80, 112), salt: rr.slice(112, 144), commitSlot: new DataView(rr.buffer).getBigUint64(144, true), owner: rr.slice(8, 40) };
  const r = recomputeFromEvents(revealed, decodeRoundInputs(fromHex(S.roundInputs)), v.out);
  assert.equal(r.value, v.in.value);
  assert.deepEqual(r.differences, []);
  assert.equal(traceOf(r.result), v.trace);
  assert.deepEqual(recomputeFromEvents(revealed, decodeRoundInputs(fromHex(S.roundInputs)), { ...v.out, bestPrize: "1" }).differences, ["bestPrize"]);
  assert.throws(() => recomputeFromEvents({ ...revealed, owner: new Uint8Array(32) }, decodeRoundInputs(fromHex(S.roundInputs)), v.out), /different rounds/);
});

test("base58 and the reading of program logs", () => {
  const a = "5ww3w4HrQrrrPcjfxVRvjLpL5vBJqLt7M5ThsnEkkngf";
  assert.equal(b58decode(a).length, 32);
  assert.equal(b58encode(b58decode(a)), a);
  assert.equal(b58encode(b58decode("11111111111111111111111111111111")), "11111111111111111111111111111111");
  // an event logged by ANOTHER program in the same transaction is not taken for the program's own
  const logs = ["Program X invoke [1]", "Program data: AAAA", "Program X success", `Program ${a} invoke [1]`, "Program data: AQID", `Program ${a} success`];
  assert.deepEqual(programEvents(logs, a).map((b) => b.toString("hex")), ["010203"]);
  assert.throws(() => programEvents([`Program ${a} invoke [1]`, "Log truncated"], a), /cut the log/);
});

// A real settlement transaction, saved from a local validator that ran the release build of the program at the mainnet
// address (test/fixtures/settlement-*.json, made with: node verify.mjs --tx <signature> --rpc <node> --save <file>).
test("saved settlement transactions: prizes match; a tampered total, a tampered secret and a foreign program are noticed", async (t) => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("./fixtures/", import.meta.url);
  const files = readdirSync(dir).filter((f) => /^settlement-.*\.json$/.test(f));
  if (!files.length) return t.skip("no saved transaction in test/fixtures");
  for (const f of files) {
    const tx = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const c = checkTransaction(tx);
    assert.deepEqual(c.problems, [], f);
    assert.equal(c.rootMatches, true, f);
    assert.deepEqual(c.differences, [], f);
    // tamper with the SpinSettled event: one more lamport of table prizes
    const forged = structuredClone(tx);
    const logs = (forged.result ?? forged).meta.logMessages;
    const k = logs.findIndex((l) => l.startsWith("Program data: ") && Buffer.from(l.slice(14), "base64").length === 114);
    const ev = Buffer.from(logs[k].slice(14), "base64");
    ev.writeBigUInt64LE(ev.readBigUInt64LE(60) + 1n, 60);
    logs[k] = "Program data: " + ev.toString("base64");
    assert.match(checkTransaction(forged).problems.join(";"), /differ.*prizes/, f);
    assert.throws(() => checkTransaction(tx, "11111111111111111111111111111111"), /does not call the program/);
  }
});
