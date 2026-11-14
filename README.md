# FAIRDRUM round check

A small, dependency-free tool that recomputes a [FAIRDRUM](https://fairdrum.to) round from the values published on the Solana blockchain — plus a short explanation of how a round number is chosen.

FAIRDRUM runs games of chance for SOL. The outcome of every round is computed by a Solana program, not by the website. This repository lets you check one part of that claim yourself: that the secret used for your round was fixed **before** you placed the bet.

## How a round number is chosen

Two parties each hold one half, and neither knows the other half in time to cheat.

| Half | Who knows it | When it is fixed |
|---|---|---|
| Round secret | the operator | before the bet: a hash covering all secrets (a Merkle root) is already written to the program |
| Hash of the bet's block | nobody — the block does not exist yet | when the network closes the block that contains the bet |

```
round value = SHA-256( "fairdrum-round-salt-v1" || secret || hash of the bet's block )
```

1. The operator generates a list of secrets and writes their Merkle root to the program.
2. You place a bet. The program gives it the next secret number and records the root that is active at that moment.
3. After the next block, the operator reveals the secret. The program checks that it belongs to the recorded root, mixes it with the block hash and computes the outcome.
4. The revealed secret and the proof are public. Anyone can repeat step 3 — that is what this tool does.

A bet and its settlement cannot share a block: the program rejects that.

## Check a round

Requires Node.js 18 or newer. Nothing is installed and nothing is sent over the network.

```
node verify.mjs --index <leaf number> --secret <hex> --proof <hex,hex,...> --root <hex> --salt <hex>
```

All five values are in the round's settlement transaction: the `RoundRevealed` event carries the leaf number, root, secret and salt; the settle instruction carries the proof. You can also paste a transaction signature into the [round check page](https://fairdrum.to/verify.html) on the site, which does the same arithmetic in your browser.

Example with the test tree from this repository:

```
node --test
```

The tests rebuild a small tree and confirm that a forged secret, a neighbour's secret, a secret from another tree, a wrong leaf number and a damaged proof are all rejected.

## What this check does not prove

Be clear about the limits — they matter more than the proof.

- **It does not prove the game is a good bet.** On average about 90% of stakes return to players and about 10% goes to the project. That is a higher house share than many competing sites advertise.
- **The operator can refuse to reveal a secret.** In that case the program refunds the stake in full and increments a public refund counter. An operator that plays its own game could, in theory, withhold only its losing rounds; the counter makes this visible but does not prevent it.
- **Collusion with a block producer is not excluded.** Whoever builds the bet's block knows its hash first. Predicting an outcome needs both that validator and the operator's secret.
- **The program can be upgraded by a single key.** The rules you verify today can be changed by the holder of that key.
- **The program's source code is not published yet**, there has been no external audit, the team is anonymous and the project holds no gambling licence. What you can check today is what the program does on-chain, not how it is written.
- **A late settlement pays without jackpots.** A round settled more than about 20 minutes after the bet pays ordinary prizes only.

## Files

| File | What it is |
|---|---|
| `verify.mjs` | the checker: library functions and a command-line tool |
| `test/verify.test.mjs` | tests, run with `node --test` |
| `test/vectors.json` | a reference tree: root, four leaves with proofs, one round value |

## Links

- Project: [fairdrum.to](https://fairdrum.to)
- Round check in the browser: [fairdrum.to/verify.html](https://fairdrum.to/verify.html)
- How the scheme works, in plain words: [fairdrum.to/fair.html](https://fairdrum.to/fair.html)
- Program address on Solana mainnet: `5ww3w4HrQrrrPcjfxVRvjLpL5vBJqLt7M5ThsnEkkngf`

Games of chance have a negative expected value for the player. 18+ only. Gambling may be illegal where you live — check your local law.

## Licence

MIT — see `LICENSE`.
