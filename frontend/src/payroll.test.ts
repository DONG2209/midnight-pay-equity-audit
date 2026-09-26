// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  type CategoryInput,
  activeCount,
  categoryWithinLimit,
  isPayrollCompliant,
  toContractCategory,
  verdictFor,
} from './payroll.js';

const THRESHOLD = 5n;

const category = (
  manCount: number,
  manAvg: number,
  womanCount: number,
  womanAvg: number,
  name = 'Cat',
): CategoryInput => ({ name, manCount, manAvg, womanCount, womanAvg });

describe('toContractCategory', () => {
  it('turns per-gender averages and counts into salary totals', () => {
    const c = toContractCategory(category(2, 100_000, 3, 95_000));
    expect(c).toEqual({ manTotal: 200_000n, manCount: 2n, womanTotal: 285_000n, womanCount: 3n });
  });
});

describe('categoryWithinLimit (mirror of the circuit)', () => {
  const within = (input: CategoryInput) => categoryWithinLimit(toContractCategory(input), THRESHOLD);

  it('accepts a small (2%) gap', () => {
    expect(within(category(1, 100_000, 1, 98_000))).toBe(true);
  });

  it('accepts an exactly-5% gap (inclusive boundary)', () => {
    expect(within(category(1, 100_000, 1, 95_000))).toBe(true);
  });

  it('rejects a 6% gap', () => {
    expect(within(category(1, 100_000, 1, 94_000))).toBe(false);
  });

  it('is direction-agnostic (women paid more than 5% above men fails too)', () => {
    expect(within(category(1, 94_000, 1, 100_000))).toBe(false);
    expect(within(category(1, 95_000, 1, 100_000))).toBe(true); // exactly 5% the other way
  });

  it('measures averages, not totals, when head counts differ', () => {
    // 2 men @100k vs 3 women @95k -> exactly 5%, compliant.
    expect(within(category(2, 100_000, 3, 95_000))).toBe(true);
  });

  it('treats a single-gender category as compliant (no gap to measure)', () => {
    expect(within(category(3, 100_000, 0, 0))).toBe(true);
    expect(within(category(0, 0, 3, 100_000))).toBe(true);
  });
});

describe('verdictFor', () => {
  it('reports the gap percentage and who it favours', () => {
    const v = verdictFor(category(1, 100_000, 1, 95_000), THRESHOLD);
    expect(v.comparable).toBe(true);
    expect(v.within).toBe(true);
    expect(v.gapPercent).toBe(5);
    expect(v.favors).toBe('men');
  });

  it('marks a single-gender category as not comparable', () => {
    const v = verdictFor(category(4, 80_000, 0, 0), THRESHOLD);
    expect(v.comparable).toBe(false);
    expect(v.gapPercent).toBeNull();
    expect(v.within).toBe(true);
  });
});

describe('isPayrollCompliant', () => {
  it('is compliant only when every category is within the limit', () => {
    const ok = [category(5, 100_000, 5, 98_000), category(2, 60_000, 2, 59_000)];
    const bad = [...ok, category(4, 80_000, 4, 74_000)]; // 7.5% category

    expect(isPayrollCompliant(ok, THRESHOLD)).toBe(true);
    expect(isPayrollCompliant(bad, THRESHOLD)).toBe(false);
  });
});

describe('activeCount', () => {
  it('counts only categories that carry employees', () => {
    const list = [category(2, 90_000, 2, 89_000), category(0, 0, 0, 0)];
    expect(activeCount(list)).toBe(1);
  });
});
