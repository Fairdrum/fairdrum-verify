// FAIRDRUM — re-computation of the prizes of a round (program upgrade No. 2). No dependencies: Node.js 18+ only.
//
// This file is the code the site runs on its "Verify a round" page, with the type annotations removed by a tool and the
// constants of the program written out below. It is the same integer arithmetic as the on-chain program
// (programs/fairdrum/src/math.rs and engine.rs, function settle_inner), step by step:
//   1. round value = SHA-256("fairdrum-round-salt-v1" || secret || salt)             (event RoundRevealed)
//   2. main stream: block b = SHA-256("FDRM-M" || value || b as u32 LE); eight u32 LE numbers per block, one per stake
//   3. every executed stake first adds its shares to the pools; a pot takes part while it holds a quarter of its start amount
//   4. the 32-bit number of the stake is compared with the thresholds: gold sector, "again" sector, nothing
//   5. a gold sector has its own hash SHA-256("FDRM-G" || value || stake number as u32 LE): bytes 0..7 choose pot or table,
//      bytes 8..11 choose the row of the table of the game
//   6. a table prize is at most a quarter of the prize bank (now, and as it was at the stake); a pot win is computed from at
//      most 3 x (jackpot, mini) or 2.5 x (super) of the start amount recorded at the stake, the rest stays in the pot;
//      of that amount a fifth (jackpot) or a third (mini) also stays in the pot as the beginning of the next one
//   7. after the last stake, what the prize bank holds above 1,600 SOL moves to the seed reserve, at most 0.5% of a bet
//      per executed stake
// Every input of a settlement is published by the program in the event RoundInputs of the settlement transaction itself.
// test/recompute.test.mjs checks this file against 3,748 rounds written by the Rust engine of the program
// (test/fixtures/recompute-vectors.json.gz) and compares the constants below with the ones the engine was built with.
// All amounts are in lamports (1 SOL = 1,000,000,000), as BigInt.
import { createHash } from "node:crypto";

/** Constants of the program (programs/fairdrum/src/consts.rs). */
export const ECON = {"ONE":1000000000,"costRaw":10000000,"S":{"prize":8939,"jack":88,"mini":44,"super":293,"seed":18},"againBps":1160,"cooldownBps":2500,"jpMinPotRaw":200000000,"miniMinPotRaw":20000000,"miniStartDiv":10,"prizeBankDiv":4,"ladderSum":10000,"jp":{"winnerBps":9500,"superBps":500,"nowBps":2000,"weeklyBps":800},"expirySlots":3000,"super":{"minPotRaw":2000000000,"winnerBps":9000},"payCap":{"jackpotBps":30000,"miniBps":30000,"superBps":25000},"keep":{"jackpotBps":2000,"miniBps":3333},"bank":{"keepRaw":1600000000000,"releaseBps":50},"modes":[{"name":"wheel","ppm":100130,"ladder":[{"tokens":0.015,"weight":5500},{"tokens":0.03,"weight":2800},{"tokens":0.1,"weight":1200},{"tokens":0.5,"weight":400},{"tokens":2.5,"weight":95},{"tokens":10,"weight":5}]},{"name":"blackjack","ppm":329436,"ladder":[{"tokens":0.02,"weight":8700},{"tokens":0.025,"weight":1000},{"tokens":0.05,"weight":250},{"tokens":0.25,"weight":45},{"tokens":2.5,"weight":5}]},{"name":"mines","ppm":97977,"ladder":[{"tokens":0.03,"weight":6200},{"tokens":0.06,"weight":2500},{"tokens":0.15,"weight":950},{"tokens":0.5,"weight":300},{"tokens":2.5,"weight":45},{"tokens":10,"weight":5}]},{"name":"crash","ppm":235562,"ladder":[{"tokens":0.015,"weight":7000},{"tokens":0.03,"weight":2300},{"tokens":0.1,"weight":600},{"tokens":0.5,"weight":85},{"tokens":2.5,"weight":13},{"tokens":10,"weight":2}]},{"name":"plinko","ppm":109154,"ladder":[{"tokens":0.02,"weight":6500},{"tokens":0.05,"weight":2500},{"tokens":0.2,"weight":800},{"tokens":1,"weight":180},{"tokens":5,"weight":17},{"tokens":10,"weight":3}]},{"name":"tower","ppm":78680,"ladder":[{"tokens":0.04,"weight":6800},{"tokens":0.09,"weight":2300},{"tokens":0.25,"weight":700},{"tokens":1.2,"weight":180},{"tokens":5,"weight":17},{"tokens":10,"weight":3}]},{"name":"hilo","ppm":214088,"ladder":[{"tokens":0.02,"weight":7000},{"tokens":0.04,"weight":2300},{"tokens":0.08,"weight":550},{"tokens":0.3,"weight":130},{"tokens":1.5,"weight":18},{"tokens":10,"weight":2}]},{"name":"slots","ppm":132819,"ladder":[{"tokens":0.015,"weight":5600},{"tokens":0.03,"weight":2900},{"tokens":0.1,"weight":1100},{"tokens":0.5,"weight":360},{"tokens":2.5,"weight":37},{"tokens":10,"weight":3}]},{"name":"mega","ppm":169029,"ladder":[{"tokens":0.012,"weight":5500},{"tokens":0.025,"weight":3000},{"tokens":0.08,"weight":1150},{"tokens":0.4,"weight":320},{"tokens":2.5,"weight":27},{"tokens":10,"weight":3}]},{"name":"dice","ppm":267980,"ladder":[{"tokens":0.02,"weight":7800},{"tokens":0.03,"weight":1500},{"tokens":0.06,"weight":500},{"tokens":0.12,"weight":160},{"tokens":0.6,"weight":35},{"tokens":3.6,"weight":5}]},{"name":"coin","ppm":140398,"ladder":[{"tokens":0.02,"weight":5200},{"tokens":0.04,"weight":2600},{"tokens":0.08,"weight":1300},{"tokens":0.16,"weight":600},{"tokens":0.32,"weight":250},{"tokens":1.28,"weight":50}]},{"name":"roulette","ppm":245330,"ladder":[{"tokens":0.02,"weight":6000},{"tokens":0.03,"weight":2600},{"tokens":0.06,"weight":900},{"tokens":0.09,"weight":350},{"tokens":0.18,"weight":120},{"tokens":0.36,"weight":30}]},{"name":"scratch","ppm":154382,"ladder":[{"tokens":0.01,"weight":4000},{"tokens":0.02,"weight":3500},{"tokens":0.05,"weight":1700},{"tokens":0.2,"weight":650},{"tokens":1,"weight":147},{"tokens":10,"weight":3}]},{"name":"limbo","ppm":223990,"ladder":[{"tokens":0.015,"weight":6000},{"tokens":0.02,"weight":2600},{"tokens":0.05,"weight":1000},{"tokens":0.2,"weight":330},{"tokens":1,"weight":68},{"tokens":10,"weight":2}]},{"name":"keno","ppm":196702,"ladder":[{"tokens":0.01,"weight":4500},{"tokens":0.02,"weight":3300},{"tokens":0.05,"weight":1500},{"tokens":0.15,"weight":600},{"tokens":1,"weight":98},{"tokens":10,"weight":2}]},{"name":"diamonds","ppm":335500,"ladder":[{"tokens":0.015,"weight":5000},{"tokens":0.02,"weight":3000},{"tokens":0.03,"weight":1300},{"tokens":0.05,"weight":500},{"tokens":0.1,"weight":170},{"tokens":0.5,"weight":30}]}]};
const E = ECON;
const nobleSha256 = (data) => new Uint8Array(createHash("sha256").update(data).digest());

const U64_MAX = (1n << 64n) - 1n;
const Q32 = 1n << 32n;
const BPS = 10000n;
const COST = BigInt(E.costRaw);
const share = (bps) => COST / BPS * BigInt(bps);
const SHARE = { prize: share(E.S.prize), jack: share(E.S.jack), mini: share(E.S.mini), super: share(E.S.super), seed: share(E.S.seed) };
const AGAIN_Q = Q32 * BigInt(E.againBps) / BPS;
const LADDER_SUM = BigInt(E.ladderSum);
const PRIZE_BANK_DIV = BigInt(E.prizeBankDiv);
const BANK_KEEP = BigInt(E.bank.keepRaw);
const POT_ODDS_MAX = (Q32 - 1n) / 4n;
const LATE_AFTER_SLOTS = BigInt(E.expirySlots);
const MODE_TABLES = E.modes.map((m) => ({
  ppm: BigInt(m.ppm),
  rows: m.ladder.map((l) => ({ amount: BigInt(Math.round(l.tokens * E.ONE)), weight: BigInt(l.weight) }))
}));
const MODE_NAMES = E.modes.map((m) => m.name);
const enc = new TextEncoder();
const TAG_MAIN = enc.encode("FDRM-M");
const TAG_GOLD = enc.encode("FDRM-G");
const TAG_SALT = enc.encode("fairdrum-round-salt-v1");
function bytes32(v, name = "value") {
  if (typeof v !== "string") {
    if (v.length !== 32) throw new Error(`${name}: expected 32 bytes, got ${v.length}`);
    return v;
  }
  const h = v.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error(`${name}: expected 32 bytes (64 hex characters)`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function concat(...parts) {
  const buf = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return buf;
}
function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
const u64 = (v, name) => {
  if (typeof v !== "bigint" || v < 0n || v > U64_MAX) throw new Error(`${name}: expected an unsigned 64-bit amount (bigint)`);
  return v;
};
const bmin = (a, b) => a < b ? a : b;
const bmax = (a, b) => a > b ? a : b;
const mulBps = (v, bps) => v * BigInt(bps) / BPS;
function roundValue(secret, salt, sha = nobleSha256) {
  return sha(concat(TAG_SALT, bytes32(secret, "secret"), bytes32(salt, "salt")));
}
function isLate(commitSlot, settleSlot) {
  return BigInt(settleSlot) >= BigInt(commitSlot) + LATE_AFTER_SLOTS;
}
const jackpotStartOf = (init) => bmax(init, BigInt(E.jpMinPotRaw));
const miniStartOf = (initJackpot) => bmax(initJackpot / BigInt(E.miniStartDiv), BigInt(E.miniMinPotRaw));
const superStartOf = (init) => bmax(init, BigInt(E.super.minPotRaw));
const openPot = (start) => start * BigInt(E.cooldownBps) / BPS;
const payCap = (start, capBps) => bmin(start * BigInt(capBps) / BPS, U64_MAX);
const potOdds = (sh, start) => bmin((sh << 32n) / bmax(start, 1n), POT_ODDS_MAX);
function roundOdds(mode, startJackpot, startSuper) {
  const t = MODE_TABLES[mode];
  if (!t) throw new Error(`mode: expected 0\u2026${MODE_TABLES.length - 1}`);
  const [j, m, s] = [jackpotStartOf(startJackpot), miniStartOf(startJackpot), superStartOf(startSuper)];
  return {
    jackpot: potOdds(SHARE.jack, j),
    mini: potOdds(SHARE.mini, m),
    super: potOdds(SHARE.super, s),
    jackpotOpenFrom: openPot(j),
    miniOpenFrom: openPot(m),
    superOpenFrom: openPot(s),
    prize: Q32 * t.ppm / 1000000n,
    again: AGAIN_Q,
    /** pay caps: fixed by the starting amounts recorded at the stake, like the chances */
    jackpotCap: payCap(j, E.payCap.jackpotBps),
    miniCap: payCap(m, E.payCap.miniBps),
    superCap: payCap(s, E.payCap.superBps)
  };
}
function mainSector(r, o) {
  const gold = o.super + o.jackpot + o.mini + o.prize;
  return r < gold ? "gold" : r < gold + o.again ? "again" : "nothing";
}
function goldSector(u1, u2, o, mode) {
  const x = u1 * (o.super + o.jackpot + o.mini + o.prize);
  if (x < o.super << 64n) return { pot: "super" };
  if (x < o.super + o.jackpot << 64n) return { pot: "jackpot" };
  if (x < o.super + o.jackpot + o.mini << 64n) return { pot: "mini" };
  const rows = MODE_TABLES[mode].rows;
  let w = u2 * LADDER_SUM >> 32n;
  for (let i = 0; i < rows.length; i++) {
    if (w < rows[i].weight) return { row: i };
    w -= rows[i].weight;
  }
  return { row: 0 };
}
function recomputeRound(input, sha = nobleSha256) {
  const { mode, stakes: n } = input;
  if (!Number.isInteger(mode) || mode < 0 || mode >= MODE_TABLES.length) throw new Error(`mode: expected 0\u2026${MODE_TABLES.length - 1}`);
  if (!Number.isInteger(n) || n < 1 || n > 4095) throw new Error("stakes: expected 1\u20264095");
  const seed = bytes32(input.value, "value");
  const prizeCap = u64(input.prizeCap, "prizeCap");
  const initJackpot = u64(input.initJackpot, "initJackpot");
  u64(input.initSuper, "initSuper");
  let prize = u64(input.prizePool, "prizePool");
  let jack = u64(input.jackpotPool, "jackpotPool");
  let mini = u64(input.miniPool, "miniPool");
  let sup = u64(input.superPool, "superPool");
  let seedPool = u64(input.seedPool, "seedPool");
  let reserve = u64(input.seedReserve, "seedReserve");
  const odds = roundOdds(mode, u64(input.startJackpot, "startJackpot"), u64(input.startSuper, "startSuper"));
  const table = MODE_TABLES[mode];
  const paid = !input.free;
  const potsPay = !input.late;
  const maxExec = 2 * n + 16;
  let block = new Uint8Array(0);
  let blockNo = -1;
  const mainDraw = (exec2) => {
    const b = exec2 - 1 >> 3;
    if (b !== blockNo) {
      block = sha(concat(TAG_MAIN, seed, u32le(b)));
      blockNo = b;
    }
    return BigInt(new DataView(block.buffer, block.byteOffset, 32).getUint32((exec2 - 1 & 7) * 4, true));
  };
  const out = [];
  const t = { spins: 0, extras: 0, gold: 0, prizes: 0n, bestPrize: 0n, miniHits: 0, miniWon: 0n, jackpotHits: 0, jackpotTotal: 0n, jackpotNow: 0n, superHits: 0, superTotal: 0n, credited: 0n, locked: 0n, perWeek: 0n, awarded: 0n };
  let promoAdded = 0n;
  const vest = (win) => {
    const now = mulBps(win, E.jp.nowBps);
    t.credited += now;
    t.locked += win - now;
    t.perWeek += mulBps(win, E.jp.weeklyBps);
    return now;
  };
  let todo = n;
  let exec = 0;
  while (todo > 0) {
    todo -= 1;
    exec += 1;
    jack += SHARE.jack;
    mini += SHARE.mini;
    sup += SHARE.super;
    seedPool += SHARE.seed;
    prize += SHARE.prize;
    const o = {
      super: paid && sup >= odds.superOpenFrom ? odds.super : 0n,
      jackpot: jack >= odds.jackpotOpenFrom ? odds.jackpot : 0n,
      mini: mini >= odds.miniOpenFrom ? odds.mini : 0n,
      prize: odds.prize,
      again: odds.again
    };
    const sector = mainSector(mainDraw(exec), o);
    if (sector === "nothing") {
      out.push({ kind: "nothing" });
      continue;
    }
    if (sector === "again") {
      const granted = exec < maxExec && prize >= COST;
      if (granted) {
        prize -= COST;
        todo += 1;
        t.extras += 1;
      }
      out.push({ kind: "again", granted });
      continue;
    }
    t.gold += 1;
    const h = sha(concat(TAG_GOLD, seed, u32le(exec)));
    const dv = new DataView(h.buffer, h.byteOffset, 32);
    const u1 = dv.getBigUint64(0, true);
    const u2 = BigInt(dv.getUint32(8, true));
    const g = goldSector(u1, u2, o, mode);
    if ("row" in g) {
      const full = table.rows[g.row].amount;
      const amount = bmin(bmin(full, prize / PRIZE_BANK_DIV), prizeCap);
      prize -= amount;
      t.credited += amount;
      t.prizes += amount;
      if (amount > t.bestPrize) t.bestPrize = amount;
      out.push({ kind: "prize", row: g.row, table: full, amount });
    } else if (g.pot === "super") {
      if (!potsPay) {
        out.push({ kind: "super", paid: false, amount: 0n, now: 0n });
        continue;
      }
      const win = mulBps(bmin(sup, odds.superCap), E.super.winnerBps);
      sup -= win;
      const now = vest(win);
      t.superHits += 1;
      t.superTotal += win;
      out.push({ kind: "super", paid: true, amount: win, now });
    } else if (g.pot === "jackpot") {
      if (!potsPay) {
        out.push({ kind: "jackpot", paid: false, pot: 0n, amount: 0n, now: 0n });
        continue;
      }
      // a fifth of the amount the win is computed from stays in the pot; the winner (95%) and the super jackpot (5%)
      // share the rest; "pot" below is what leaves the pot
      const base0 = bmin(jack, odds.jackpotCap);
      const paidOut = base0 - mulBps(base0, E.keep.jackpotBps);
      const win = mulBps(paidOut, E.jp.winnerBps);
      const toSuper = mulBps(paidOut, E.jp.superBps);
      const pot = win + toSuper;
      const keep = jack - pot;
      sup += toSuper;
      const now = vest(win);
      t.jackpotNow += now;
      t.jackpotHits += 1;
      t.jackpotTotal += pot;
      const base = keep + seedPool;
      const top = bmin(initJackpot > base ? initJackpot - base : 0n, reserve);
      jack = base + top;
      reserve -= top;
      seedPool = 0n;
      out.push({ kind: "jackpot", paid: true, pot, amount: win, now });
    } else {
      if (!potsPay) {
        out.push({ kind: "mini", paid: false, amount: 0n });
        continue;
      }
      // a third of the amount the win is computed from stays in the pot
      const base0 = bmin(mini, odds.miniCap);
      const win = base0 - mulBps(base0, E.keep.miniBps);
      const keep = mini - win;
      t.credited += win;
      t.miniWon += win;
      t.miniHits += 1;
      const ms = miniStartOf(initJackpot);
      const top = bmin(ms > keep ? ms - keep : 0n, reserve);
      mini = keep + top;
      reserve -= top;
      out.push({ kind: "mini", paid: true, amount: win });
    }
  }
  // the bank's surplus: what the prize bank holds above its keep after the last stake moves to the seed reserve, at most
  // 0.5% of a bet per executed stake
  const excess = prize > BANK_KEEP ? prize - BANK_KEEP : 0n;
  const bankReleased = bmin(excess, BigInt(exec) * share(E.bank.releaseBps));
  prize -= bankReleased;
  reserve += bankReleased;
  t.spins = exec;
  t.awarded = t.credited + t.locked;
  return { stakes: out, totals: t, after: { prizePool: prize, jackpotPool: jack, miniPool: mini, superPool: sup, seedPool, seedReserve: reserve, promoAdded, bankReleased } };
}
const ASSUMPTIONS = [
  "prize bank large enough at the stake and at settlement: no table prize is cut and every free re-spin is granted",
  "mini pot, jackpot and super pot each held at least a quarter of their start amount during the whole round",
  "pot sizes and the seed reserve are unknown: the amount of a pot win is not computed"
];
function withAssumptions(p) {
  const { startJackpot, startSuper } = p;
  const ample = 1n << 62n;
  return {
    mode: p.mode,
    stakes: p.stakes,
    free: !!p.free,
    late: p.late,
    value: p.value,
    prizeCap: ample,
    startJackpot,
    startSuper,
    prizePool: ample,
    jackpotPool: ample,
    miniPool: ample,
    superPool: ample,
    seedPool: 0n,
    seedReserve: ample,
    initJackpot: jackpotStartOf(startJackpot),
    initSuper: superStartOf(startSuper)
  };
}
const big = (x) => BigInt(x.toString());
function differencesFromEvent(r, ev, opts = {}) {
  const t = r.totals;
  const pairs = [
    ["spins", BigInt(t.spins), ev.spins],
    ["extras", BigInt(t.extras), ev.extras],
    ["gold", BigInt(t.gold), ev.gold],
    ["prizes", t.prizes, ev.prizes],
    ["bestPrize", t.bestPrize, ev.bestPrize],
    ["miniHits", BigInt(t.miniHits), ev.miniHits],
    ["jackpotHits", BigInt(t.jackpotHits), ev.jackpotHits],
    ["superHits", BigInt(t.superHits), ev.superHits]
  ];
  if (opts.potAmounts !== false) pairs.push(["miniWon", t.miniWon, ev.miniWon], ["jackpotTotal", t.jackpotTotal, ev.jackpotTotal], ["superTotal", t.superTotal, ev.superTotal]);
  return pairs.filter(([, mine, theirs]) => mine !== big(theirs)).map(([name]) => name);
}
const EVENT_AMOUNTS = ["prizeCap", "startJackpot", "startSuper", "prizePool", "jackpotPool", "miniPool", "superPool", "seedPool", "seedReserve", "initJackpot", "initSuper"];
const snake = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const field = (ev, k) => {
  const v = ev[k] ?? ev[snake(k)];
  if (v === void 0 || v === null) throw new Error(`RoundInputs: field ${k} is missing`);
  return v;
};
function inputsFromEvent(ev, value) {
  const e = ev;
  const flag = (k) => {
    const v = field(e, k);
    if (typeof v !== "boolean") throw new Error(`RoundInputs: field ${k} must be true or false`);
    return v;
  };
  const amounts = Object.fromEntries(EVENT_AMOUNTS.map((k) => [k, u64(big(field(e, k)), k)]));
  return { mode: Number(field(e, "mode")), stakes: Number(field(e, "n")), free: flag("free"), late: flag("late"), value, ...amounts };
}
const roundInputsDiscriminator = (sha = nobleSha256) => sha(enc.encode("event:RoundInputs")).slice(0, 8);
const ROUND_INPUTS_LEN = 8 + 32 + 8 + 1 + 2 + 1 + 1 + 11 * 8;
function decodeRoundInputs(data, sha = nobleSha256) {
  const d = roundInputsDiscriminator(sha);
  if (data.length < 8 || d.some((b, i) => data[i] !== b)) return null;
  if (data.length !== ROUND_INPUTS_LEN) throw new Error(`RoundInputs: expected ${ROUND_INPUTS_LEN} bytes, got ${data.length}`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bool = (o) => {
    if (data[o] > 1) throw new Error("RoundInputs: bad boolean");
    return data[o] === 1;
  };
  const out = { owner: data.slice(8, 40), commitSlot: dv.getBigUint64(40, true), mode: data[48], n: dv.getUint16(49, true), free: bool(51), late: bool(52) };
  EVENT_AMOUNTS.forEach((k, i) => out[k] = dv.getBigUint64(53 + 8 * i, true));
  return out;
}
const b32 = (v, name) => bytes32(typeof v === "string" ? v : Uint8Array.from(v), name);
const keyHex = (x) => {
  if (x && typeof x.toBytes === "function") return toHex(x.toBytes());
  if (typeof x === "string") return /^[0-9a-fA-F]{64}$/.test(x) ? x.toLowerCase() : null;
  return x && typeof x.length === "number" && x.length === 32 ? toHex(x) : null;
};
const sameKey = (a, b) => {
  const [x, y] = [keyHex(a), keyHex(b)];
  return x === null || y === null || x === y;
};
function recomputeFromEvents(revealed, inputs, settled, sha = nobleSha256) {
  const r = revealed;
  const i = inputs;
  const slotR = r.commitSlot ?? r.commit_slot;
  const slotI = i.commitSlot ?? i.commit_slot;
  if (slotR != null && slotI != null && big(slotR) !== big(slotI)) throw new Error("RoundRevealed and RoundInputs are from different rounds (commit slot)");
  if (r.owner != null && i.owner != null && !sameKey(r.owner, i.owner)) throw new Error("RoundRevealed and RoundInputs are from different rounds (owner)");
  const value = roundValue(b32(revealed.secret, "secret"), b32(revealed.salt, "salt"), sha);
  const input = inputsFromEvent(inputs, value);
  const result = recomputeRound(input, sha);
  return { value: toHex(value), input, result, differences: settled ? differencesFromEvent(result, settled) : null };
}
function traceOf(r) {
  return r.stakes.map((s) => {
    switch (s.kind) {
      case "nothing":
        return ".";
      case "again":
        return s.granted ? "a" : "A";
      case "prize":
        return `p${s.row}:${s.amount}`;
      case "mini":
        return s.paid ? `m:${s.amount}` : "M";
      case "jackpot":
        return s.paid ? `j:${s.pot}:${s.amount}` : "J";
      case "super":
        return s.paid ? `s:${s.amount}` : "S";
    }
  }).join(",");
}
export {
  ASSUMPTIONS,
  LATE_AFTER_SLOTS,
  MODE_NAMES,
  MODE_TABLES,
  ROUND_INPUTS_LEN,
  bytes32,
  decodeRoundInputs,
  differencesFromEvent,
  goldSector,
  inputsFromEvent,
  isLate,
  mainSector,
  recomputeFromEvents,
  recomputeRound,
  roundInputsDiscriminator,
  roundOdds,
  roundValue,
  toHex,
  traceOf,
  withAssumptions
};
