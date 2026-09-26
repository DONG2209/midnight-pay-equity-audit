// SPDX-License-Identifier: Apache-2.0

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { describe, expect, it } from 'vitest';
import { AuditClient } from '../audit-client.js';
import {
  type CategoryPayroll,
  createEmployerPrivateState,
} from '../witnesses.js';

setNetworkId('undeployed');

const THRESHOLD = 5n;

// Deterministic keys/salt so tests are reproducible.
const EMPLOYER_KEY = new Uint8Array(32).fill(7);
const IMPOSTOR_KEY = new Uint8Array(32).fill(42);
const SALT_A = new Uint8Array(32).fill(1);
const SALT_B = new Uint8Array(32).fill(2);

/** One category, given each side's average salary and head count. */
const cat = (manAvg: number, manCount: number, womanAvg: number, womanCount: number): CategoryPayroll => ({
  manTotal: BigInt(manAvg * manCount),
  manCount: BigInt(manCount),
  womanTotal: BigInt(womanAvg * womanCount),
  womanCount: BigInt(womanCount),
});

const deployWith = async (categories: CategoryPayroll[], salt = SALT_A) => {
  const state = createEmployerPrivateState(EMPLOYER_KEY, categories, salt);
  return AuditClient.deploy(THRESHOLD, state);
};

/** A JSON-friendly snapshot of the public ledger, safe to deep-equal. */
const snapshot = (client: AuditClient) => {
  const l = client.getLedger();
  return {
    thresholdPercent: l.thresholdPercent,
    employerRegistered: l.employerRegistered,
    auditRound: l.auditRound,
    hasResult: l.hasResult,
    lastCompliant: l.lastCompliant,
    lastPeriod: l.lastPeriod,
    lastCategoryCount: l.lastCategoryCount,
    employerCommitment: Array.from(l.employerCommitment),
    lastPayrollCommitment: Array.from(l.lastPayrollCommitment),
  };
};

describe('Confidential Pay-Equity Audit contract', () => {
  it('deploys with the chosen threshold and no result yet', async () => {
    const client = await deployWith([cat(100_000, 1, 98_000, 1)]);
    const l = client.getLedger();

    expect(l.thresholdPercent).toBe(THRESHOLD);
    expect(l.employerRegistered).toBe(false);
    expect(l.hasResult).toBe(false);
    expect(l.auditRound).toBe(0n);
  });

  it('initializes deterministically from the same threshold', async () => {
    const a = await deployWith([cat(100_000, 1, 98_000, 1)]);
    const b = await deployWith([cat(50_000, 3, 49_000, 2)]);
    // Before any audit, the public state depends only on the threshold — the
    // payroll (private) leaves no trace on the ledger.
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('lets the first caller register as the employer, and only once', async () => {
    const client = await deployWith([cat(100_000, 1, 98_000, 1)]);

    await client.registerEmployer();
    expect(client.getLedger().employerRegistered).toBe(true);

    await expect(client.registerEmployer()).rejects.toThrow(/already registered/i);
  });

  it('refuses an audit before an employer is registered', async () => {
    const client = await deployWith([cat(100_000, 1, 98_000, 1)]);
    await expect(client.submitAudit('2027-H1')).rejects.toThrow(/no employer registered/i);
  });

  it('refuses an audit from anyone other than the registered employer', async () => {
    const client = await deployWith([cat(100_000, 1, 98_000, 1)]);
    await client.registerEmployer();

    const impostorState = createEmployerPrivateState(IMPOSTOR_KEY, [cat(100_000, 1, 98_000, 1)], SALT_A);
    const asImpostor = AuditClient.joinExisting(client, impostorState);
    await expect(asImpostor.submitAudit('2027-H1')).rejects.toThrow(/not authorized/i);
  });

  it('publishes COMPLIANT for a small (2%) gap', async () => {
    const client = await deployWith([cat(100_000, 1, 98_000, 1)]);
    await client.registerEmployer();
    await client.submitAudit('2027-H1');

    const l = client.getLedger();
    expect(l.hasResult).toBe(true);
    expect(l.lastCompliant).toBe(true);
    expect(l.lastPeriod).toBe('2027-H1');
    expect(l.lastCategoryCount).toBe(1n);
    expect(l.auditRound).toBe(1n);
  });

  it('treats an exactly-5% gap as COMPLIANT (boundary, inclusive)', async () => {
    const client = await deployWith([cat(100_000, 1, 95_000, 1)]);
    await client.registerEmployer();
    await client.submitAudit('2027-H1');
    expect(client.getLedger().lastCompliant).toBe(true);
  });

  it('publishes NON-COMPLIANT for a 6% gap', async () => {
    const client = await deployWith([cat(100_000, 1, 94_000, 1)]);
    await client.registerEmployer();
    await client.submitAudit('2027-H1');
    expect(client.getLedger().lastCompliant).toBe(false);
  });

  it('flags a gap in either direction (women paid more than 5% above men)', async () => {
    const client = await deployWith([cat(94_000, 1, 100_000, 1)]);
    await client.registerEmployer();
    await client.submitAudit('2027-H1');
    expect(client.getLedger().lastCompliant).toBe(false);
  });

  it('measures the gap on averages, not totals (unequal head counts)', async () => {
    // Men: 2 people, avg 100k. Women: 3 people, avg 95k -> exactly 5%, compliant,
    // even though the raw salary totals (200k vs 285k) differ wildly.
    const client = await deployWith([cat(100_000, 2, 95_000, 3)]);
    await client.registerEmployer();
    await client.submitAudit('2027-H1');
    expect(client.getLedger().lastCompliant).toBe(true);
  });

  it('is COMPLIANT only if EVERY category is within the limit', async () => {
    const client = await deployWith([
      cat(100_000, 5, 98_000, 5), // 2% — fine
      cat(80_000, 4, 74_000, 4), // 7.5% — fails
      cat(60_000, 2, 59_000, 2), // <2% — fine
    ]);
    await client.registerEmployer();
    await client.submitAudit('2027-H1');

    const l = client.getLedger();
    expect(l.lastCompliant).toBe(false);
    expect(l.lastCategoryCount).toBe(3n);
  });

  it('ignores single-gender categories (no cross-gender gap to measure)', async () => {
    const client = await deployWith([
      cat(100_000, 3, 0, 0), // only men -> compliant by construction
      cat(0, 0, 100_000, 3), // only women -> compliant by construction
    ]);
    await client.registerEmployer();
    await client.submitAudit('2027-H1');
    expect(client.getLedger().lastCompliant).toBe(true);
  });

  it('never writes a salary to the public ledger', async () => {
    const client = await deployWith([cat(123_456, 2, 98_765, 3)]);
    await client.registerEmployer();
    await client.submitAudit('2027-H1');

    // The only fields on the ledger are the threshold, the employer commitment,
    // the boolean result, and public metadata — enumerate them and confirm no
    // salary total or head count appears anywhere.
    const l = client.getLedger();
    const keys = Object.keys(l).sort();
    expect(keys).toEqual(
      [
        'auditRound',
        'employerCommitment',
        'employerRegistered',
        'hasResult',
        'lastCategoryCount',
        'lastCompliant',
        'lastPayrollCommitment',
        'lastPeriod',
        'thresholdPercent',
      ].sort(),
    );

    const numbers = [l.thresholdPercent, l.auditRound, l.lastCategoryCount];
    expect(numbers).not.toContain(123_456n);
    expect(numbers).not.toContain(98_765n);
    expect(l.lastPayrollCommitment).toHaveLength(32);
  });

  it('produces a hiding commitment: same payroll, different salt -> different commitment', async () => {
    const a = await deployWith([cat(100_000, 2, 98_000, 2)], SALT_A);
    await a.registerEmployer();
    await a.submitAudit('2027-H1');

    const b = await deployWith([cat(100_000, 2, 98_000, 2)], SALT_B);
    await b.registerEmployer();
    await b.submitAudit('2027-H1');

    expect(Array.from(a.getLedger().lastPayrollCommitment)).not.toEqual(
      Array.from(b.getLedger().lastPayrollCommitment),
    );
    // ...yet both reach the same public verdict.
    expect(a.getLedger().lastCompliant).toBe(b.getLedger().lastCompliant);
  });

  it('produces a binding commitment: different payroll -> different commitment', async () => {
    const a = await deployWith([cat(100_000, 2, 98_000, 2)], SALT_A);
    await a.registerEmployer();
    await a.submitAudit('2027-H1');

    const b = await deployWith([cat(100_000, 2, 97_000, 2)], SALT_A);
    await b.registerEmployer();
    await b.submitAudit('2027-H1');

    expect(Array.from(a.getLedger().lastPayrollCommitment)).not.toEqual(
      Array.from(b.getLedger().lastPayrollCommitment),
    );
  });

  it('supports several reporting periods, bumping the audit round each time', async () => {
    const client = await deployWith([cat(100_000, 2, 98_000, 2)]);
    await client.registerEmployer();

    await client.submitAudit('2027-H1');
    expect(client.getLedger().auditRound).toBe(1n);
    expect(client.getLedger().lastCompliant).toBe(true);

    // A later period with a regression to a 7% gap flips the public verdict.
    client.setPayroll([cat(100_000, 2, 93_000, 2)]);
    await client.submitAudit('2027-H2');

    const l = client.getLedger();
    expect(l.auditRound).toBe(2n);
    expect(l.lastPeriod).toBe('2027-H2');
    expect(l.lastCompliant).toBe(false);
  });

  it('rejects an audit whose threshold does not match the deployed one', async () => {
    const client = await deployWith([cat(100_000, 1, 98_000, 1)]);
    await client.registerEmployer();
    await expect(client.submitAudit('2027-H1', 10n)).rejects.toThrow(/threshold/i);
  });
});
