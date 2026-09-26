// SPDX-License-Identifier: Apache-2.0
//
// Client-side payroll helpers. The compliance check here is a faithful mirror
// of `categoryWithinLimit` in contract/src/pay-equity.compact — same division-
// free cross-multiplication — so the UI can preview, per category, exactly what
// the zero-knowledge circuit will conclude, before anything is proven. The
// circuit remains the source of truth; this is only a local preview.
//
// Salaries entered here NEVER leave the browser: they become witnesses to the
// contract, which discloses only the single boolean and a commitment.

import type { CategoryPayroll } from '@midnight-level4/pay-equity-contract';

/** One category as typed into the UI: average salary + head count per gender. */
export type CategoryInput = {
  readonly name: string;
  readonly manCount: number;
  readonly manAvg: number;
  readonly womanCount: number;
  readonly womanAvg: number;
};

export type CategoryVerdict = {
  readonly name: string;
  /** Both genders present, so a gap can be measured. */
  readonly comparable: boolean;
  /** Rounded gap percentage for display, or null for a single-gender category. */
  readonly gapPercent: number | null;
  readonly within: boolean;
  readonly favors: 'men' | 'women' | 'equal' | null;
};

const round = (n: number): bigint => BigInt(Math.round(n));

/** Converts a UI category (averages) into the contract's totals-based shape. */
export const toContractCategory = (c: CategoryInput): CategoryPayroll => ({
  manTotal: round(c.manCount * c.manAvg),
  manCount: BigInt(Math.max(0, Math.trunc(c.manCount))),
  womanTotal: round(c.womanCount * c.womanAvg),
  womanCount: BigInt(Math.max(0, Math.trunc(c.womanCount))),
});

/**
 * Division-free compliance test, identical to the circuit:
 *   compliant  ⇔  100 * |crossM - crossW|  ≤  threshold * max(crossM, crossW)
 * where crossM = manTotal * womanCount and crossW = womanTotal * manCount.
 */
export const categoryWithinLimit = (cat: CategoryPayroll, thresholdPercent: bigint): boolean => {
  if (cat.manCount === 0n || cat.womanCount === 0n) return true;
  const crossM = cat.manTotal * cat.womanCount;
  const crossW = cat.womanTotal * cat.manCount;
  const hi = crossM >= crossW ? crossM : crossW;
  const diff = crossM >= crossW ? crossM - crossW : crossW - crossM;
  return diff * 100n <= hi * thresholdPercent;
};

/** A per-category verdict for the UI, including a human-readable gap percentage. */
export const verdictFor = (input: CategoryInput, thresholdPercent: bigint): CategoryVerdict => {
  const cat = toContractCategory(input);
  const comparable = cat.manCount > 0n && cat.womanCount > 0n;
  if (!comparable) {
    return { name: input.name, comparable: false, gapPercent: null, within: true, favors: null };
  }
  const avgM = Number(cat.manTotal) / Number(cat.manCount);
  const avgW = Number(cat.womanTotal) / Number(cat.womanCount);
  const hi = Math.max(avgM, avgW);
  const gap = hi === 0 ? 0 : (Math.abs(avgM - avgW) / hi) * 100;
  const favors = avgM === avgW ? 'equal' : avgM > avgW ? 'men' : 'women';
  return {
    name: input.name,
    comparable: true,
    gapPercent: Math.round(gap * 100) / 100,
    within: categoryWithinLimit(cat, thresholdPercent),
    favors,
  };
};

/** Overall verdict = every category within the limit (matches the contract's AND). */
export const isPayrollCompliant = (
  inputs: readonly CategoryInput[],
  thresholdPercent: bigint,
): boolean => inputs.every((c) => categoryWithinLimit(toContractCategory(c), thresholdPercent));

/** Counts categories that actually carry employees (for the public category count). */
export const activeCount = (inputs: readonly CategoryInput[]): number =>
  inputs.filter((c) => toContractCategory(c).manCount > 0n || toContractCategory(c).womanCount > 0n)
    .length;
