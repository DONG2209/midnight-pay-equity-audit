// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { describeError } from './errors.js';

describe('describeError', () => {
  it('reads code and reason off a DApp Connector API error', () => {
    const apiError = Object.assign(new Error(''), { code: 'Rejected', reason: 'User declined' });

    expect(describeError(apiError)).toBe('Rejected: User declined');
  });

  it('falls back to the message of an ordinary Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('handles plain-object rejections, which String() would turn into "[object Object]"', () => {
    expect(describeError({ code: 'Disconnected', reason: 'lost the wallet' })).toBe('Disconnected: lost the wallet');
  });

  it('stringifies anything else', () => {
    expect(describeError('nope')).toBe('nope');
    expect(describeError(undefined)).toBe('undefined');
  });
});
