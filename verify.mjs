#!/usr/bin/env node
// FAIRDRUM round check — check a round number from the values published on-chain.
// No dependencies: Node.js 18+ only. Nothing is sent anywhere, except in the mode --tx <signature>, which asks the Solana
// node you name (--rpc) for that one public transaction; --tx-file <file> checks a saved transaction with no network at all.
//
//   leaf  = SHA-256( 0x00 || index (u64, little-endian) || secret )
//   node  = SHA-256( 0x01 || left || right )
//   value = SHA-256( "fairdrum-round-salt-v1" || secret || salt )
//
// The root of the tree is written to the program BEFORE the bet. The salt is the hash of the
// bet's block, which does not exist until the bet is included. The secret is revealed afterwards.
import { createHash } from "node:crypto";
import { MODE_NAMES, decodeRoundInputs, isLate, recomputeFromEvents } from "./recompute.mjs";

const sha = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
const u64le = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const bytes32 = (hex, name) => {
  const b = Buffer.from(String(hex).replace(/^0x/, ""), "hex");
  if (b.length !== 32) throw new Error(`${name}: expected 32 bytes (64 hex characters), got ${b.length}`);
  return b;
};

/** Root reached from a revealed secret and its proof (sibling hashes, bottom to top). */
export function rootOf(index, secretHex, proofHex) {
  let h = sha(Buffer.from([0]), u64le(index), bytes32(secretHex, "secret"));
  let i = BigInt(index);
  for (const [k, sib] of proofHex.entries()) {
    const s = bytes32(sib, `proof[${k}]`);
    h = (i & 1n) === 0n ? sha(Buffer.from([1]), h, s) : sha(Buffer.from([1]), s, h);
    i >>= 1n;
  }
  return h.toString("hex");
}

/** The number every outcome of the round is derived from. */
export function roundValue(secretHex, saltHex) {
  return sha(Buffer.from("fairdrum-round-salt-v1"), bytes32(secretHex, "secret"), bytes32(saltHex, "salt")).toString("hex");
}

/** Full check: does the revealed secret belong to the committed root? */
export function checkRound({ index, secret, proof, root, salt }) {
  const computedRoot = rootOf(index, secret, proof);
  return {
    computedRoot,
    rootMatches: computedRoot === String(root).replace(/^0x/, "").toLowerCase(),
    value: salt ? roundValue(secret, salt) : null,
  };
}

/**
 * A report of refunded and late-settled rounds (format "fairdrum-refunds-v1", written by the house and published as a file).
 * For every round: the secret must lead to the root (refunded rounds carry the proof), and the round number given in the file
 * must be the one computed from the secret and the hash of the bet's block. What this file cannot tell you, and what you check
 * in a block explorer: that the transaction named in "refundSignature" / "settleSignature" exists, belongs to the program and
 * to that player, and that "root" was the root in force (it is in the RoundRevealed events of the neighbouring settled rounds).
 */
export function checkRefunds(report) {
  if (!report || report.format !== "fairdrum-refunds-v1" || !Array.isArray(report.rounds)) throw new Error("not a fairdrum-refunds-v1 report");
  return report.rounds.map((r) => {
    const out = { kind: r.kind, player: r.player, leaf: r.leaf, signature: r.refundSignature ?? r.settleSignature, problems: [] };
    try {
      if (r.kind === "refunded") {
        if (!Array.isArray(r.proof) || !r.proof.length) out.problems.push("no proof");
        else if (rootOf(r.leaf, r.secret, r.proof) !== String(r.root).toLowerCase()) out.problems.push("the secret does NOT lead to the root");
      } else if (r.kind !== "late") out.problems.push(`unknown kind ${r.kind}`);
      bytes32(r.secret, "secret");
      if (r.betBlockHash) {
        const v = roundValue(r.secret, r.betBlockHash);
        if (r.roundNumber !== v) out.problems.push("the round number in the file is not sha256(secret, block hash)");
        out.value = v;
      } else if (r.roundNumber) out.problems.push("a round number is given without the block hash it is computed from");
      out.potSectors = r.outcome?.potSectors ?? null;
    } catch (e) {
      out.problems.push(e.message);
    }
    return out;
  });
}

// ── a whole settlement transaction: secret → root, round value, and the prizes re-computed (program upgrade No. 2) ──

/** The address of the FAIRDRUM program on the Solana main network. */
export const PROGRAM = "5ww3w4HrQrrrPcjfxVRvjLpL5vBJqLt7M5ThsnEkkngf";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const zeros = str.length - str.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(zeros), n === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex")]);
}
export function b58encode(buf) {
  let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0")), out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = "1" + out; }
  return out;
}
/** first 8 bytes of an Anchor event / instruction: SHA-256("event:<Name>") / SHA-256("global:<name>") */
const disc = (s) => sha(Buffer.from(s)).subarray(0, 8);
const D_REVEALED = disc("event:RoundRevealed"), D_SETTLED = disc("event:SpinSettled"), D_SETTLE_IX = disc("global:spin_settle");
const sol = (l) => { const v = BigInt(l); return `${v / 1_000_000_000n}.${(v % 1_000_000_000n).toString().padStart(9, "0")} SOL`; };

/** The events the program itself wrote in a transaction: only "Program data:" lines logged while the program is the one running. */
export function programEvents(logs, program) {
  const stack = [], out = [];
  for (const l of logs) {
    let m;
    if ((m = /^Program (\S+) invoke \[\d+\]$/.exec(l))) stack.push(m[1]);
    else if ((m = /^Program (\S+) (success|failed.*)$/.exec(l))) stack.pop();
    else if ((m = /^Program data: (\S+)$/.exec(l)) && stack[stack.length - 1] === program) out.push(Buffer.from(m[1], "base64"));
    else if (/^Log truncated/.test(l)) throw new Error("the node cut the log of this transaction (\"Log truncated\"): its events cannot be read from this node");
  }
  return out;
}

/**
 * Checks one settlement transaction (the JSON a Solana node returns for getTransaction, encoding "json").
 * 1. the revealed secret leads to the root the transaction names (the proof is in the arguments of spin_settle);
 * 2. the round value is SHA-256 of the secret and the hash of the bet's block;
 * 3. the prizes are re-computed from the event RoundInputs and compared with the event SpinSettled.
 * What it cannot tell you: that this root was the one written to the program BEFORE the bet. That is seen in a block explorer:
 * the root is the same in the settlements of the neighbouring rounds, and it was set by a set_house_root transaction earlier.
 */
export function checkTransaction(tx, program = PROGRAM) {
  const t = tx?.result ?? tx;
  if (!t?.meta || !t?.transaction) throw new Error("this is not a transaction as a node returns it (getTransaction, encoding json)");
  if (t.meta.err) throw new Error("this transaction failed on the network: it changed nothing");
  const msg = t.transaction.message;
  const keys = [...msg.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey)), ...(t.meta.loadedAddresses?.writable ?? []), ...(t.meta.loadedAddresses?.readonly ?? [])];
  if (!keys.includes(program)) throw new Error(`this transaction does not call the program ${program}`);
  const events = programEvents(t.meta.logMessages ?? [], program);
  const rr = events.find((e) => e.length === 152 && e.subarray(0, 8).equals(D_REVEALED));
  const ss = events.find((e) => e.length === 114 && e.subarray(0, 8).equals(D_SETTLED));
  const ri = events.map((e) => decodeRoundInputs(new Uint8Array(e))).find(Boolean);
  if (!rr || !ss) throw new Error("no settlement of a round in this transaction (events RoundRevealed and SpinSettled not found)");
  const revealed = { owner: rr.subarray(8, 40), leaf: rr.readBigUInt64LE(40), root: rr.subarray(48, 80).toString("hex"), secret: rr.subarray(80, 112).toString("hex"), salt: rr.subarray(112, 144).toString("hex"), commitSlot: rr.readBigUInt64LE(144) };
  const settled = { owner: ss.subarray(8, 40), spins: ss.readBigUInt64LE(40), extras: ss.readBigUInt64LE(48), gold: ss.readUInt32LE(56), prizes: ss.readBigUInt64LE(60), bestPrize: ss.readBigUInt64LE(68), miniHits: ss.readUInt32LE(76), miniWon: ss.readBigUInt64LE(80), jackpotHits: ss.readUInt32LE(88), jackpotTotal: ss.readBigUInt64LE(92), superHits: ss.readUInt32LE(100), superTotal: ss.readBigUInt64LE(104), forfeited: ss[112] === 1, refunded: ss[113] === 1 };
  const out = { program, slot: t.slot, player: b58encode(revealed.owner), leaf: revealed.leaf, root: revealed.root, commitSlot: revealed.commitSlot, value: roundValue(revealed.secret, revealed.salt), settled, problems: [] };
  // the proof: arguments of the spin_settle instruction of this program (top level)
  const ix = msg.instructions.find((i) => keys[i.programIdIndex] === program && b58decode(i.data).subarray(0, 8).equals(D_SETTLE_IX));
  if (ix) {
    const d = b58decode(ix.data), n = d.readUInt32LE(40);
    const proof = Array.from({ length: n }, (_, k) => d.subarray(44 + 32 * k, 76 + 32 * k).toString("hex"));
    if (d.length !== 44 + 32 * n || d.subarray(8, 40).toString("hex") !== revealed.secret) out.problems.push("the secret in the instruction is not the secret in the event");
    out.rootMatches = rootOf(revealed.leaf, revealed.secret, proof) === revealed.root;
    out.proofLength = n;
    if (!out.rootMatches) out.problems.push("the revealed secret does NOT lead to the root named in the transaction");
  } else out.rootMatches = null; // settled through another program's call: the proof is not at the top level
  if (!ri) {
    out.recomputed = null; // the program deployed first (before upgrade No. 2) does not publish the inputs of a settlement
    return out;
  }
  const r = recomputeFromEvents(revealed, ri, settled);
  out.inputs = r.input;
  out.game = MODE_NAMES[r.input.mode] ?? `mode ${r.input.mode}`;
  out.recomputed = r.result;
  out.differences = r.differences;
  if (r.value !== out.value) out.problems.push("round value mismatch");
  if (t.slot != null && isLate(revealed.commitSlot, t.slot) !== r.input.late) out.problems.push(`the event says the round was ${r.input.late ? "late" : "on time"}, the slots say otherwise`);
  if (!ss.subarray(8, 40).equals(rr.subarray(8, 40))) out.problems.push("the events are about different players");
  if (r.differences.length) out.problems.push(`the contract's totals differ from the re-computation in: ${r.differences.join(", ")}`);
  return out;
}

function printTransaction(sig, c) {
  const t = c.recomputed?.totals, s = c.settled;
  console.log(`transaction   : ${sig ?? "(from file)"} · slot ${c.slot} · program ${c.program}`);
  console.log(`player        : ${c.player}`);
  console.log(`committed root: ${c.root} (leaf ${c.leaf}, bet in slot ${c.commitSlot})`);
  console.log(c.rootMatches === null ? "secret → root : not checked (the proof is not among the top-level instructions of this transaction)" : c.rootMatches ? `secret → root : OK   — the revealed secret belongs to this root (proof of ${c.proofLength} hashes)` : "secret → root : FAIL — the secret does NOT lead to this root");
  console.log(`round value   : ${c.value}`);
  console.log(`contract paid : ${s.spins} stakes executed (${s.extras} re-spins), ${s.gold} on gold · table prizes ${sol(s.prizes)} (largest ${sol(s.bestPrize)}) · mini ×${s.miniHits} ${sol(s.miniWon)} · jackpot ×${s.jackpotHits} from ${sol(s.jackpotTotal)} · super ×${s.superHits} ${sol(s.superTotal)}`);
  if (!c.recomputed) {
    console.log("re-computed   : not possible — this settlement has no RoundInputs event: it was made by the program as it was before upgrade No. 2, which did not publish the inputs. The round value above can still be checked.");
    return c.problems.length ? 1 : 3;
  }
  const i = c.inputs;
  console.log(`round         : ${c.game} · ×${i.stakes} stakes · ${i.late ? "LATE settlement (pot sectors pay nothing)" : "settled on time"} · prize bank at settlement ${sol(i.prizePool)}`);
  console.log(`re-computed   : ${t.spins} stakes executed (${t.extras} re-spins), ${t.gold} on gold · table prizes ${sol(t.prizes)} (largest ${sol(t.bestPrize)}) · mini ×${t.miniHits} ${sol(t.miniWon)} · jackpot ×${t.jackpotHits} from ${sol(t.jackpotTotal)} · super ×${t.superHits} ${sol(t.superTotal)}`);
  console.log(`to the player : ${sol(t.awarded)} (${sol(t.credited)} at once, ${sol(t.locked)} released weekly)`);
  for (const p of c.problems) console.log(`PROBLEM       : ${p}`);
  if (c.problems.length) { console.log("PRIZES DO NOT MATCH — see the lines above"); return 1; }
  console.log("PRIZES MATCH  — the contract paid exactly what the published inputs and the round value give, field by field.");
  console.log("Now compare with a block explorer: this transaction exists, and the committed root was set before the bet (README.md).");
  return 0;
}

// ── command line ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const txSig = arg("tx"), txFile = arg("tx-file");
  if (txSig || txFile) {
    try {
      const { readFileSync, writeFileSync } = await import("node:fs");
      let tx;
      if (txFile) tx = JSON.parse(readFileSync(txFile, "utf8"));
      else {
        const rpc = arg("rpc") ?? "https://api.mainnet-beta.solana.com";
        const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [txSig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }] }) });
        if (!res.ok) throw new Error(`the node answered ${res.status}`);
        tx = await res.json();
        if (tx.error) throw new Error(`the node answered: ${tx.error.message}`);
        if (!tx.result) throw new Error("the node does not have this transaction (a public node keeps only recent history: use a node with the full history)");
        if (arg("save")) writeFileSync(arg("save"), JSON.stringify(tx));
      }
      process.exit(printTransaction(txSig, checkTransaction(tx, arg("program") ?? PROGRAM)));
    } catch (e) {
      console.error("Error:", e.message);
      process.exit(2);
    }
  }
  const refunds = arg("refunds");
  if (refunds) {
    try {
      const { readFileSync } = await import("node:fs");
      const res = checkRefunds(JSON.parse(readFileSync(refunds, "utf8")));
      let failed = 0;
      for (const r of res) {
        const mark = r.problems.length ? "FAIL" : "OK  ";
        if (r.problems.length) failed++;
        const pots = r.potSectors?.length ? ` · pot sectors: ${r.potSectors.map((p) => `${p.pot} at bet ${p.bet}`).join(", ")}` : "";
        console.log(`${mark} ${r.kind.padEnd(8)} leaf ${String(r.leaf).padStart(7)} · player ${r.player ?? "?"} · tx ${String(r.signature).slice(0, 20)}…${r.value ? ` · round number ${r.value.slice(0, 16)}…` : " · no block hash on chain: no round number"}${pots}${r.problems.length ? ` · ${r.problems.join("; ")}` : ""}`);
      }
      const n = (k) => res.filter((r) => r.kind === k).length;
      console.log(`${n("refunded")} refunded, ${n("late")} late-settled, ${failed} failed`);
      console.log(failed ? "FAIL — see the lines above" : `OK   — all ${res.length} rounds check. Now compare the transactions and the root with a block explorer (see README.md).`);
      process.exit(failed ? 1 : 0);
    } catch (e) {
      console.error("Error:", e.message);
      process.exit(2);
    }
  }
  const index = arg("index"), secret = arg("secret"), root = arg("root"), salt = arg("salt"), proof = arg("proof");
  if (!index || !secret || !root || !proof) {
    console.log(`Usage:
  node verify.mjs --index <leaf number> --secret <hex> --proof <hex,hex,...> --root <hex> [--salt <hex>]
  node verify.mjs --refunds <refunds-….json>     check a published report of refunded and late-settled rounds
  node verify.mjs --tx <signature> [--rpc <node URL>] [--save <file>]
                                                 a settlement transaction: secret → root, round value, and the PRIZES
                                                 re-computed and compared with what the contract paid (rounds settled
                                                 after program upgrade No. 2). Default node: the public main-network one
  node verify.mjs --tx-file <file>               the same from a saved transaction (--save), with no network
  (--program <address> for a program other than ${PROGRAM})

All values are public: they are in the round's settlement transaction (event RoundRevealed and the
arguments of the settle instruction). See README.md.`);
    process.exit(2);
  }
  try {
    const r = checkRound({ index, secret, proof: proof.split(",").filter(Boolean), root, salt });
    console.log("computed root :", r.computedRoot);
    console.log("committed root:", String(root).toLowerCase());
    console.log(r.rootMatches ? "OK   — the revealed secret belongs to the committed root" : "FAIL — the secret does NOT lead to this root");
    if (r.value) console.log("round value   :", r.value);
    process.exit(r.rootMatches ? 0 : 1);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(2);
  }
}
