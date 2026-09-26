# Confidential Pay-Equity Audit — Product Proposal

> Prove EU gender pay-gap compliance in zero knowledge — disclosing a single
> yes/no, never a salary.

## The problem

The **EU Pay Transparency Directive (2023/970)** had to be transposed into
national law by **7 June 2026**; by most counts only a handful of the 27 member
states did so on time. From **June 2027**, employers with 250+ staff must report
their gender pay gap annually, and **an unjustified gap of 5% or more in any
category of workers triggers a mandatory joint pay assessment**.

Proving compliance today forces a bad trade-off:

- **Hand over raw payroll** to consultants or auditors — every individual salary
  leaves the company.
- **Publish per-category averages** — which, for small categories, effectively
  discloses a specific colleague's pay (if a category has one woman, her salary
  *is* the "average").

Either way, employees and regulators are left trusting the employer's
spreadsheet, and individuals lose their pay privacy in the name of transparency.

## The idea

A Midnight smart contract where the employer keeps its payroll entirely in
**private state**, publishes only a **commitment** to it, and proves in **zero
knowledge** that the gender pay gap is within the 5% limit **in every job
category** — disclosing a single **yes/no** and nothing else.

Regulators and employees verify the proof on chain. No salary, no average, no
head count ever leaves the employer. This is *selective disclosure applied to
compliance*: the auditor learns **"compliant"**, not the payroll.

## How it works (the privacy-critical core)

The pay gap in a category is `|avgMen − avgWomen| / max(avgMen, avgWomen)`. To
prove `gap ≤ 5%` over integer salaries **without division** (and without leaking
the averages), the circuit cross-multiplies:

```
crossM = manTotal · womanCount        (∝ avgMen)
crossW = womanTotal · manCount         (∝ avgWomen)      ← common denominator cancels
compliant  ⇔  100 · |crossM − crossW|  ≤  threshold · max(crossM, crossW)
```

It checks this for every category, ANDs the results, and writes to the public
ledger **only**:

- the single boolean verdict,
- a **hiding, binding commitment** to the payroll (`persistentHash(salt ‖ payroll)`),
- public metadata: the reporting period, the number of categories, the threshold,
- a one-way commitment to the employer's identity (so only they can file an audit).

Everything else — salaries, averages, head counts, and even *the size of the
gap* — stays in the witness and never touches the chain.

## Who it's for

- **Employers (250+ staff)** who must file annually and want to prove compliance
  without exposing payroll to third parties or to the public record.
- **Regulators / equality bodies** who need a verifiable attestation, not a data
  dump they then have to secure.
- **Employees and works councils** who want independent assurance their category
  is within the law, without any colleague's pay being revealed.

## Roadmap

- **Level 4 (this MVP):** per-job-category pay-gap proof with a payroll
  commitment, employer authentication, a full test suite, CI/CD, and a verifier
  UI. Runs the real compiled Compact contract client-side; deployable to Preprod
  via `scripts/deploy-preprod.ts`.
- **Level 5:** employee-side **inclusion proofs** and anonymous challenges, so an
  employer cannot commit fake data, plus a **minimum-wage compliance** proof.
- **Level 6:** reporting periods and history, larger payrolls via **Merkle
  batching** of individual records, a dedicated regulator view, and full testnet
  deployment.

## Why Midnight

Midnight's Compact language makes the disclosure boundary a **compile-time
guarantee**: every value that crosses from private witness to public ledger must
be wrapped in an explicit `disclose(...)`, and the compiler rejects the contract
otherwise. That turns "we promise we didn't leak salaries" into something the
toolchain enforces and anyone can re-verify from source.
