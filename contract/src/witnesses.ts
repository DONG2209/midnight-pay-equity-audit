// SPDX-License-Identifier: Apache-2.0
//
// Witnesses supply the contract's PRIVATE inputs. Everything returned from a
// witness function stays on the caller's machine — only the values a circuit
// explicitly wraps in `disclose(...)` (see pay-equity.compact) ever reach the
// public ledger or a transcript an observer can read. For this contract that
// means: the single yes/no result, a hiding commitment to the payroll, and the
// public metadata (period, category count, threshold) — never a salary.

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from './managed/pay-equity/contract/index.js';

/** Must match `Vector<6, CategoryPayroll>` in pay-equity.compact. */
export const CATEGORY_SLOTS = 6;

/**
 * One job category's aggregated payroll, as plain bigints:
 *   - `manTotal` / `womanTotal`: sum of yearly salaries (whole currency units)
 *   - `manCount` / `womanCount`: number of employees
 *
 * A category with no men or no women (a zero count) has no cross-gender gap to
 * measure and is treated by the contract as compliant.
 */
export type CategoryPayroll = {
  readonly manTotal: bigint;
  readonly manCount: bigint;
  readonly womanTotal: bigint;
  readonly womanCount: bigint;
};

/**
 * Local, off-chain state for the employer interacting with the audit contract:
 * the payroll itself, a salt that makes the on-chain payroll commitment hiding,
 * and the employer's secret key (used only to prove authorship of an audit —
 * its hash, never the key, goes on chain).
 */
export type PayEquityPrivateState = {
  readonly employerSecretKey: Uint8Array;
  readonly payrollSalt: Uint8Array;
  readonly payroll: readonly CategoryPayroll[];
};

const EMPTY_CATEGORY: CategoryPayroll = {
  manTotal: 0n,
  manCount: 0n,
  womanTotal: 0n,
  womanCount: 0n,
};

/**
 * Pads (or truncates) a list of categories to exactly CATEGORY_SLOTS entries,
 * so it lines up with the fixed-size `Vector<6, …>` the circuit expects. Empty
 * trailing slots are all-zero and therefore compliant.
 */
export const padCategories = (categories: readonly CategoryPayroll[]): CategoryPayroll[] => {
  if (categories.length > CATEGORY_SLOTS) {
    throw new Error(`at most ${CATEGORY_SLOTS} categories are supported, got ${categories.length}`);
  }
  const padded = categories.slice();
  while (padded.length < CATEGORY_SLOTS) {
    padded.push(EMPTY_CATEGORY);
  }
  return padded;
};

/** How many of the padded slots are non-empty (for the public category count). */
export const activeCategoryCount = (categories: readonly CategoryPayroll[]): bigint =>
  BigInt(
    categories.filter(
      (c) => c.manCount > 0n || c.womanCount > 0n || c.manTotal > 0n || c.womanTotal > 0n,
    ).length,
  );

/** Builds the employer's private state from a payroll and a secret key. */
export const createEmployerPrivateState = (
  employerSecretKey: Uint8Array,
  categories: readonly CategoryPayroll[],
  payrollSalt: Uint8Array = randomSecretKey(),
): PayEquityPrivateState => ({
  employerSecretKey,
  payrollSalt,
  payroll: padCategories(categories),
});

/**
 * Generates a fresh, random 32-byte value (secret key or salt). Uses the
 * standard Web Crypto API, available as a global both in the browser and in
 * Node.js 20+ — no bundler polyfill required either side.
 */
export const randomSecretKey = (): Uint8Array => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
};

export const witnesses = {
  employerSecretKey: (
    context: WitnessContext<Ledger, PayEquityPrivateState>,
  ): [PayEquityPrivateState, Uint8Array] => [
    context.privateState,
    context.privateState.employerSecretKey,
  ],
  payrollSalt: (
    context: WitnessContext<Ledger, PayEquityPrivateState>,
  ): [PayEquityPrivateState, Uint8Array] => [context.privateState, context.privateState.payrollSalt],
  payroll: (
    context: WitnessContext<Ledger, PayEquityPrivateState>,
  ): [PayEquityPrivateState, CategoryPayroll[]] => [
    context.privateState,
    context.privateState.payroll.map((c) => ({ ...c })),
  ],
};
