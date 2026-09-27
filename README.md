<!--
  Repo slug used in the badge and links below is assumed to be
  DONG2209/midnight-pay-equity-audit — change it in one place here if you push
  under a different name.
-->

# Confidential Pay-Equity Audit — Midnight Level 4

[![Level 4 CI](https://github.com/DONG2209/midnight-pay-equity-audit/actions/workflows/level4-ci.yml/badge.svg)](https://github.com/DONG2209/midnight-pay-equity-audit/actions/workflows/level4-ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

> **Idea:** Confidential Pay-Equity Audit — prove EU gender pay-gap compliance in
> zero knowledge, without revealing anyone's salary.
> Full product proposal: **[PROPOSAL.md](./PROPOSAL.md)**.

The moon swells past half: more is disclosed now than hidden — but the one thing
that must stay hidden, does. This dApp proves an employer's gender pay gap is
within the EU's 5% limit **in every job category**, and publishes only a single
**yes/no** plus a commitment to the payroll. No salary, no average, no head
count, not even the size of the gap, ever leaves the employer.

```
"Pay-equity audit, reporting period 2027-H1"     ← public
   threshold: 5%   categories: 3                  ← public
   compliant: true                                ← public (the only verdict)
   payrollCommitment: a91f…7c02                   ← public, hides the payroll
   every salary, average, head count, and the gap ← never on chain, never disclosed
```

## Contents

- [What this is](#what-this-is)
- [Repository layout](#repository-layout)
- [Quickstart](#quickstart)
- [Scripts](#scripts)
- [The contract](#the-contract)
- [Privacy model](#privacy-model)
- [Tests](#tests)
- [CI/CD](#cicd)
- [The verifier frontend](#the-verifier-frontend)
- [Going to Preprod](#going-to-preprod)
- [Live demo](#live-demo)
- [Product profile (X)](#product-profile-x)
- [Demo video](#demo-video)
- [Submission checklist](#submission-checklist)
- [License](#license)

## What this is

A small, real Compact contract (`contract/src/pay-equity.compact`) that:

- keeps a per-category payroll in **private state** (witnesses),
- proves, in zero knowledge, that `|avgMen − avgWomen| / max(avg) ≤ 5%` in every
  category — **by cross-multiplication, with no division** and without revealing
  the averages,
- authenticates the employer via a one-way key commitment, and
- publishes **only** the boolean verdict, a hiding commitment to the payroll, and
  public metadata (period, category count, threshold).

…compiled with the actual Midnight `compact` toolchain and exercised by a real
test suite (17 contract tests, not mocked).

A companion **verifier frontend** (`frontend/`) runs that exact compiled contract
client-side: connect a Midnight wallet (Lace), type in a payroll (which never
leaves the browser), run the audit, and read the entire public ledger — the yes/no
and the commitment — off the screen. See [The verifier frontend](#the-verifier-frontend).

## Repository layout

```
.
├── contract/                      Compact contract + TypeScript test suite
│   ├── src/pay-equity.compact     the circuits (registerEmployer, submitAudit)
│   ├── src/witnesses.ts           private-state / witness plumbing
│   ├── src/audit-client.ts        reusable client used by tests and the frontend
│   └── src/test/pay-equity.test.ts
├── frontend/                      Vite + TypeScript browser verifier
│   ├── src/main.ts                UI wiring
│   ├── src/payroll.ts             division-free gap math (mirrors the circuit)
│   └── src/identity.ts            wallet-signature → employer key + salt
├── scripts/deploy-preprod.ts      the Preprod deployment path
├── docs/test-output.txt           captured passing test run
└── .github/workflows/level4-ci.yml   compile + typecheck + test + build on every push
```

This is an npm workspaces monorepo (`contract` + `frontend`) so the frontend can
import the contract package directly — see [`package.json`](./package.json).

## Quickstart

Prerequisites: **Node.js 22+** and the **Compact developer tools**.

```bash
# 1. Install the Compact compiler (once per machine)
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
source ~/.bashrc   # or ~/.zshrc
compact update 0.34.0

# 2. Install workspace dependencies
npm install

# 3. Compile the contract, then run the tests
npm run compact
npm run test

# 4. Try the browser verifier
npm run dev --workspace frontend   # http://localhost:5173
```

## Scripts

Run from the repo root unless noted.

| Command | What it does |
|---|---|
| `npm run compact` | Compiles `pay-equity.compact` → `contract/src/managed/` (skips ZK proving-key generation for speed; `npm run compact:zk --workspace contract` does the full build) |
| `npm run test` | Runs both Vitest suites: 17 contract tests + 34 frontend tests |
| `npm run test:compile --workspace contract` | Compiles *and* tests in one step (what CI runs) |
| `npm run typecheck` | Type-checks both workspaces |
| `npm run build` | Builds the contract package and the frontend for production |
| `npm run dev --workspace frontend` | Starts the verifier dApp locally |

## The contract

`contract/src/pay-equity.compact` — two exported circuits:

| Circuit | Purpose |
|---|---|
| `registerEmployer()` | Binds whoever calls it first as the employer, by publishing `persistentHash(tag, contract address, employerSecretKey)` — the key itself never appears on chain. |
| `submitAudit(period, activeCategories, threshold)` | Proves every category is within the limit over the private payroll, and publishes the boolean verdict + a hiding payroll commitment + public metadata. Only the registered employer can call it. |

The private inputs (witnesses) are the per-category aggregates (`manTotal`,
`manCount`, `womanTotal`, `womanCount`), a random salt, and the employer's secret
key. An internal helper, `categoryWithinLimit`, does the division-free
cross-multiplication described in [PROPOSAL.md](./PROPOSAL.md):

```
compliant  ⇔  100 · |crossM − crossW|  ≤  threshold · max(crossM, crossW)
   where crossM = manTotal · womanCount,  crossW = womanTotal · manCount
```

which accepts a 2% gap, accepts an **exactly** 5% gap, and rejects a 6% gap — in
**either** direction (it flags a gap disadvantaging men or women), and correctly
compares averages even when the two head counts differ.

## Privacy model

This is the part every submission in this cohort has to state explicitly.

### An observer CAN learn

- The compliance threshold this contract enforces (`thresholdPercent`, e.g. 5).
- The single yes/no verdict of the latest audit (`lastCompliant`).
- The reporting-period label and how many categories it covered.
- A hiding commitment to the payroll (`lastPayrollCommitment`) and a one-way hash
  of the employer's identity (`employerCommitment`).
- How many audits have been run (`auditRound`).

### An observer CANNOT learn

- **Any salary**, or any category's **average** or **total** pay.
- The **size of the gap** — only whether it is within the limit. A compliant
  audit at 0.1% and one at exactly 5% look identical on chain.
- Any category's **head counts**, so small categories can't be reverse-engineered
  into an individual's pay.
- **Which** category (if any) came closest to failing.
- The employer's **secret key** — `registerEmployer`/`submitAudit` only ever
  disclose a hash of it.

Every place a witness (private) value is allowed to influence public state is
marked with an explicit `disclose(...)` in `pay-equity.compact` — that is
Compact's compiler enforcing this boundary at compile time, not just a
convention. The test *"never writes a salary to the public ledger"* enumerates
the entire public ledger and asserts no salary or head count appears in it.

## Tests

```
$ npm run test
 ✓ Confidential Pay-Equity Audit contract  (17 tests)
    · deploys with the chosen threshold and no result yet
    · publishes COMPLIANT for a small (2%) gap
    · treats an exactly-5% gap as COMPLIANT (boundary, inclusive)
    · publishes NON-COMPLIANT for a 6% gap
    · flags a gap in either direction (women paid more than 5% above men)
    · measures the gap on averages, not totals (unequal head counts)
    · is COMPLIANT only if EVERY category is within the limit
    · ignores single-gender categories (no cross-gender gap to measure)
    · never writes a salary to the public ledger
    · produces a hiding commitment (same payroll, different salt → different commitment)
    · produces a binding commitment (different payroll → different commitment)
    · refuses an audit from anyone other than the registered employer
    · … and 5 more
 ✓ frontend  (34 tests: payroll math, wallet-key derivation, error formatting,
              and a full jsdom click-through of the real UI + compiled contract)

 Test Files  5 passed (5)
      Tests  51 passed (51)
```

Full captured run: [`docs/test-output.txt`](./docs/test-output.txt). Every test
runs against the **real compiled contract** via `@midnight-ntwrk/compact-runtime`'s
local circuit simulator (`contract/src/audit-client.ts`) — no mocking of contract
logic, no live network required. The frontend's `payroll.ts` re-implements the
gap check and is tested to agree with the circuit, so the on-screen preview never
disagrees with the proof.

## CI/CD

[`.github/workflows/level4-ci.yml`](./.github/workflows/level4-ci.yml) runs on
every push and pull request:

1. Installs the real Compact toolchain (same installer command as above).
2. `npm ci` — installs workspace dependencies from the committed lockfile.
3. Compiles the contract (`npm run compact`).
4. Type-checks both workspaces.
5. Runs both test suites.
6. Builds the contract package and the frontend, uploading the frontend build as
   a workflow artifact.

See the badge at the top of this file for the latest run.

## The verifier frontend

`frontend/` is a small Vite + TypeScript app, no framework. The flow:

1. **Connect a wallet.** "Detect wallets" finds any wallet that injects the
   Midnight DApp Connector API; pick the network id to hint (`preprod` /
   `preview` / `testnet` / `undeployed`) and press Connect.
   **[Lace](https://www.lace.io/) (Midnight preview build)** is currently the
   only wallet that injects this API — wallets from other chains won't show up,
   which is expected.
2. **The wallet signs one message.** Your **employer audit key** and payroll salt
   are `SHA-256(role tag ‖ signature)` (`frontend/src/identity.ts`): only the
   holder of the wallet's private key can produce that signature, so only you can
   author an audit for the contract.
3. **Enter the payroll** (stays in the browser) and press **Run audit**. The app
   deploys the contract, registers you as the employer, and submits one
   confidential audit — all as real circuit calls.
4. The **raw public ledger** is rendered as JSON, so the privacy claims above are
   something you can literally read off the screen.

There is also a **demo mode** (throwaway key, no wallet) so anyone without Lace
can still try it.

**What runs where, honestly:** the wallet connects and signs, but the circuits
execute in the browser tab against an in-memory ledger, using the same compiled
contract as the tests. Submitting to a live Midnight network is the separate step
in [Going to Preprod](#going-to-preprod).

## Going to Preprod

The sandbox proves the contract's logic and privacy properties. Putting it live
on **Midnight Preprod** with a verifiable contract address needs infrastructure
that can't live in a browser tab or a CI runner — a funded wallet, a proof
server, and an indexer — so it's a scripted, deliberate step:

1. Run a proof server and point at a Preprod indexer (see
   [`frontend/.env.example`](./frontend/.env.example) for the variables).
2. Build the full ZK artifacts once: `npm run compact:zk --workspace contract`.
3. Fund a Preprod wallet from the faucet and run
   [`scripts/deploy-preprod.ts`](./scripts/deploy-preprod.ts) — its header lists
   the exact deps and commands. It deploys the contract, then calls
   `registerEmployer` and `submitAudit`.
4. Paste the printed contract address into `frontend/.env` and the box below.

> **Live Preprod contract address:** ⏳ _to be added after deployment_
> `addr_...`

The deploy script uses `@midnight-ntwrk/midnight-js-contracts`; because that SDK
is pre-1.0 and its provider APIs move between releases, the script's header says
how to cross-check the wiring against Midnight's current tutorials. The contract,
its circuits, its tests and the verifier UI in this repo were all executed in
full while writing this submission.

## Live demo

**<https://midnight-pay-equity-audit-frontend.vercel.app/>** — deployed straight
from this repo via `vercel.json` / `scripts/vercel-build.sh` (installs the Compact
toolchain, compiles the contract, builds the frontend — the same steps as CI).
Connect Lace (or pick demo mode), enter a payroll, and run a confidential audit;
the whole public ledger (verdict + commitment, no salaries) updates on screen.

## Product profile (X)

> ⏳ _to be added_ — the product's public build-in-public profile on X:
> **[@your_handle](https://x.com/your_handle)**.

## Demo video

> ⏳ _to be added_ — a short walkthrough of the MVP: connect Lace → sign to derive
> the employer key → enter a payroll → run the audit → read the public ledger
> (yes/no + commitment, no salaries) → tweak the payroll past 5% and watch the
> verdict flip to NOT COMPLIANT.

## Submission checklist

| Requirement | Status |
|---|---|
| Working MVP (Midnight privacy model) | ✅ contract + verifier frontend, both real and run in this repo |
| Live on Preprod (verifiable address) | ⏳ deploy via [`scripts/deploy-preprod.ts`](./scripts/deploy-preprod.ts), then paste the address above |
| Documentation (README + setup + usage) | ✅ this file + [PROPOSAL.md](./PROPOSAL.md) |
| CI/CD pipeline with passing runs | ✅ [`level4-ci.yml`](./.github/workflows/level4-ci.yml) — see badge |
| Product X profile, linked in README | ⏳ see [Product profile (X)](#product-profile-x) |
| Demo video of the MVP | ⏳ see [Demo video](#demo-video) |
| Minimum 15 meaningful commits | ✅ see `git log` |
| Privacy model documented | ✅ see [Privacy model](#privacy-model) |

Items marked ⏳ need a wallet/proof server, an X account, or a screen recorder —
things only the maintainer can provide — and are wired up and waiting for those
inputs.

## License

Apache-2.0 — see [`LICENSE`](./LICENSE).
