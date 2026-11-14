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
