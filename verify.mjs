#!/usr/bin/env node
// FAIRDRUM round check — recompute a round from the values published on-chain.
// No dependencies: Node.js 18+ only. Nothing is sent anywhere.
//
//   leaf  = SHA-256( 0x00 || index (u64, little-endian) || secret )
//   node  = SHA-256( 0x01 || left || right )
//   value = SHA-256( "fairdrum-round-salt-v1" || secret || salt )
//
// The root of the tree is written to the program BEFORE the bet. The salt is the hash of the
// bet's block, which does not exist until the bet is included. The secret is revealed afterwards.
import { createHash } from "node:crypto";

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

// ── command line ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const index = arg("index"), secret = arg("secret"), root = arg("root"), salt = arg("salt"), proof = arg("proof");
  if (!index || !secret || !root || !proof) {
    console.log(`Usage:
  node verify.mjs --index <leaf number> --secret <hex> --proof <hex,hex,...> --root <hex> [--salt <hex>]

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
