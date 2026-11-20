// Run: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rootOf, roundValue, checkRound } from "../verify.mjs";

const V = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));

test("every published leaf leads to the committed root", () => {
  for (const [index, leaf] of Object.entries(V.leaves)) assert.equal(rootOf(index, leaf.secret, leaf.proof), V.root, `leaf ${index}`);
});

test("round value matches the reference", () => {
  const salt = "09".repeat(32);
  assert.equal(roundValue(V.leaves["1"].secret, salt), V.value);
});

test("a different secret is rejected", () => {
  const leaf = V.leaves["1"];
  const forged = "00" + leaf.secret.slice(2);
  assert.equal(checkRound({ index: 1, secret: forged, proof: leaf.proof, root: V.root }).rootMatches, false);
});

test("a neighbour's secret is rejected at this position", () => {
  assert.equal(checkRound({ index: 1, secret: V.leaves["0"].secret, proof: V.leaves["1"].proof, root: V.root }).rootMatches, false);
});

test("a secret from another tree is rejected", () => {
  assert.equal(checkRound({ index: 0, secret: V.depth5secret0, proof: V.leaves["0"].proof, root: V.root }).rootMatches, false);
});

test("a shortened, lengthened or damaged proof is rejected", () => {
  const leaf = V.leaves["17"];
  const bad = [leaf.proof.slice(1), [...leaf.proof, leaf.proof[0]], [leaf.proof[0].replace(/^../, "ff"), ...leaf.proof.slice(1)]];
  for (const proof of bad) assert.equal(checkRound({ index: 17, secret: leaf.secret, proof, root: V.root }).rootMatches, false);
});

test("the wrong leaf number is rejected", () => {
  const leaf = V.leaves["17"];
  assert.equal(checkRound({ index: 16, secret: leaf.secret, proof: leaf.proof, root: V.root }).rootMatches, false);
});

test("malformed input is reported, not accepted", () => {
  assert.throws(() => rootOf(0, "abcd", []), /32 bytes/);
});

// ── reports of refunded and late-settled rounds (--refunds) ──
import { checkRefunds } from "../verify.mjs";
const refunded = (o = {}) => ({ kind: "refunded", player: "P", leaf: 1, root: V.root, secret: V.leaves["1"].secret, proof: V.leaves["1"].proof, refundSignature: "sig", betBlockHash: null, roundNumber: null, ...o });
const report = (rounds) => ({ format: "fairdrum-refunds-v1", rounds });

test("refunds report: a refunded round with its secret and proof checks; with a block hash the round number is recomputed", () => {
  const salt = "09".repeat(32);
  const res = checkRefunds(report([refunded(), refunded({ betBlockHash: salt, roundNumber: V.value }), { kind: "late", player: "P", leaf: 1, root: V.root, secret: V.leaves["1"].secret, betBlockHash: salt, roundNumber: V.value, settleSignature: "s" }]));
  assert.deepEqual(res.map((r) => r.problems), [[], [], []]);
  assert.equal(res[1].value, V.value);
});

test("refunds report: a wrong secret, a neighbour's leaf, a wrong round number and a foreign format are caught", () => {
  const salt = "09".repeat(32);
  assert.match(checkRefunds(report([refunded({ secret: "00" + V.leaves["1"].secret.slice(2) })]))[0].problems.join(), /does NOT lead/);
  assert.match(checkRefunds(report([refunded({ leaf: 0 })]))[0].problems.join(), /does NOT lead/);
  assert.match(checkRefunds(report([refunded({ betBlockHash: salt, roundNumber: "11".repeat(32) })]))[0].problems.join(), /round number in the file/);
  assert.match(checkRefunds(report([refunded({ roundNumber: V.value })]))[0].problems.join(), /without the block hash/);
  assert.match(checkRefunds(report([refunded({ proof: [] })]))[0].problems.join(), /no proof/);
  assert.throws(() => checkRefunds({ format: "x", rounds: [] }));
});
