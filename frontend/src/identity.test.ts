// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { SIGN_IN_MESSAGE, deriveIdentity, randomIdentity, type SigningWallet } from './identity.js';

const walletSigning = (signature: string): SigningWallet => ({
  signData: async () => ({ signature }),
});

const SIG_A = 'a'.repeat(128);
const SIG_B = 'b'.repeat(128);

describe('deriveIdentity', () => {
  it('derives a 32-byte employer key and salt from the wallet signature', async () => {
    const id = await deriveIdentity(walletSigning(SIG_A));

    expect(id.source).toBe('wallet-signature');
    expect(id.employerKey).toHaveLength(32);
    expect(id.salt).toHaveLength(32);
  });

  it('is deterministic: the same signature always yields the same values', async () => {
    const first = await deriveIdentity(walletSigning(SIG_A));
    const second = await deriveIdentity(walletSigning(SIG_A));

    expect(Array.from(first.employerKey)).toEqual(Array.from(second.employerKey));
    expect(Array.from(first.salt)).toEqual(Array.from(second.salt));
  });

  it('gives different wallets (different signatures) unrelated keys', async () => {
    const a = await deriveIdentity(walletSigning(SIG_A));
    const b = await deriveIdentity(walletSigning(SIG_B));

    expect(Array.from(a.employerKey)).not.toEqual(Array.from(b.employerKey));
    expect(Array.from(a.salt)).not.toEqual(Array.from(b.salt));
  });

  it('keeps the employer key and salt of one wallet unrelated (domain separation)', async () => {
    const id = await deriveIdentity(walletSigning(SIG_A));

    expect(Array.from(id.employerKey)).not.toEqual(Array.from(id.salt));
  });

  it('asks the wallet to sign the fixed, human-readable message', async () => {
    let asked = '';
    const wallet: SigningWallet = {
      signData: async (data) => {
        asked = data;
        return { signature: SIG_A };
      },
    };

    await deriveIdentity(wallet);

    expect(asked).toBe(SIGN_IN_MESSAGE);
  });

  it('falls back to random values, and says why, when the user rejects the prompt', async () => {
    const rejecting: SigningWallet = {
      signData: async () => {
        throw new Error('User rejected the request');
      },
    };

    const id = await deriveIdentity(rejecting);

    expect(id.source).toBe('random-session');
    expect(id.fallbackReason).toContain('User rejected');
  });

  it('refuses to hash an unusably short signature into a guessable key', async () => {
    const id = await deriveIdentity(walletSigning(''));

    expect(id.source).toBe('random-session');
    expect(id.fallbackReason).toContain('unusable signature');
  });
});

describe('randomIdentity', () => {
  it('produces fresh, unrelated values on every call', () => {
    const a = randomIdentity();
    const b = randomIdentity();

    expect(Array.from(a.employerKey)).not.toEqual(Array.from(b.employerKey));
    expect(Array.from(a.employerKey)).not.toEqual(Array.from(a.salt));
  });
});
