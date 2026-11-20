# Refunded and late-settled rounds

This folder holds the reports the house publishes about every round that did **not** end the normal way:

- a **refunded** round: the round was not settled in time and the bet went back to the player in full;
- a **late-settled** round: the round was settled more than about 20 minutes after the bet. It paid its table prizes, but
  the jackpots were not played in it.

A round is decided by a secret the house committed to before the bet. In a normal round that secret is published on chain
at settlement. In a refunded round it never appears on chain, so the house publishes it here. With it anyone can see what
the round would have been, and that the house did not let a losing round expire while settling the winning ones.

## The files

One file per run of the report: `refunds-<date>-slot<slot>.json`. Files are added, never changed or removed. If no file
is here yet, no report has been published yet: the reports begin with program upgrade No. 2. Whether any round was
refunded before that is a public counter (`refunds`) in the program's settings account; compare it yourself.

Each file is JSON with `"format": "fairdrum-refunds-v1"`, the program address, the last transaction and slot it covers,
and a list `rounds`. Every entry names the player, the transactions of the bet and of the refund (or the late
settlement), the root of the secret tree and the number of the secret in it. A refunded round also carries the secret
and the path from it to the root. If the hash of the bet's block was recorded on chain, the entry has the round number
and what the program computes from it: the order of outcomes, the table prizes and whether a jackpot sector was hit.

## How to check a file

You need Node.js 18 or newer and this repository. Nothing is installed and nothing is sent anywhere.

```
node verify.mjs --refunds refunds/<file>.json
```

One line per round, `OK` or `FAILED`, then a summary:

```
OK   refunded leaf     812 · player 7xKX… · tx 4hQ9… · no block hash on chain: no round number
OK   late     leaf     915 · player 9aBc… · tx 2mNp… · round number 5d0c…
1 refunded, 1 late-settled, 0 failed
OK   — all 2 rounds check. Now compare the transactions and the root with a block explorer (see README.md).
```

`OK` means: the secret leads to the root named in the entry, and the round number in the file is the one computed from
that secret and the hash of the bet's block.

What the file alone cannot prove, and what you check in any Solana block explorer:

- the transaction named in `refundSignature` / `settleSignature` exists, belongs to the program and to that player;
- `root` was the root in force at the time: the same root is in the `RoundRevealed` events of the settled rounds
  before and after it;
- no refund is missing: compare the number of refunded rounds in these files with the `refunds` counter of the program.
