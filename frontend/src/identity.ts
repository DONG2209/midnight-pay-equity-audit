// SPDX-License-Identifier: Apache-2.0
//
// Where the employer's secret key and payroll salt (the contract's non-payroll
// witnesses — see contract/src/witnesses.ts) come from.
//
// The employer key is what proves an audit was authored by THIS employer
// (registerEmployer publishes only a one-way hash of it). It must therefore be
// something only the employer can reproduce, so we derive it from a wallet
// *signature*: only the holder of the wallet's private key can produce that
// signature. The payroll salt makes the on-chain payroll commitment hiding; we
// derive it from the same signature (with a different domain tag) so the whole
// identity is recoverable from the wallet alone — nothing to store or lose.
//
// Nothing here is sent anywhere — the values stay in this tab's memory and are
// only ever fed to the contract as witnesses.

import { describeError } from './errors.js';

/** The slice of the wallet's connected API this module needs. */
export type SigningWallet = {
  signData(
    data: string,
    options: { encoding: 'text'; keyType: 'unshielded' },
  ): Promise<{ signature: string }>;
};

export type IdentitySource = 'wallet-signature' | 'random-session';

export type EmployerIdentity = {
  readonly employerKey: Uint8Array;
  readonly salt: Uint8Array;
  readonly source: IdentitySource;
  /** Why we fell back to random values, when `source` is `random-session`. */
  readonly fallbackReason?: string;
};

/** Shown to the user in the wallet's signing prompt — keep it human-readable. */
export const SIGN_IN_MESSAGE =
  'Confidential Pay-Equity Audit (Midnight Level 4): derive my employer audit key. ' +
  'This does not move any funds and never reveals a salary.';

// A real signature is at least 32 bytes; anything much shorter means the wallet
// returned something unusable, and hashing it would give a guessable key.
const MIN_SIGNATURE_LENGTH = 32;

// NUL can't appear in either tag, so tag/signature boundaries stay unambiguous.
const SEPARATOR = String.fromCharCode(0);

const sha256 = async (domainTag: string, signature: string): Promise<Uint8Array> => {
  const bytes = new TextEncoder().encode(`${domainTag}${SEPARATOR}${signature}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
};

const randomKey = (): Uint8Array => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
};

/** Unrelated random values — used for "demo mode" and as a fallback. */
export const randomIdentity = (fallbackReason?: string): EmployerIdentity => ({
  employerKey: randomKey(),
  salt: randomKey(),
  source: 'random-session',
  fallbackReason,
});

/**
 * Derives the employer key and payroll salt from a wallet signature over
 * {@link SIGN_IN_MESSAGE}. If the wallet can't or won't sign (unsupported, or
 * the user dismisses the prompt), falls back to random session values so the
 * demo never dead-ends — the returned `source` says which one you got.
 */
export const deriveIdentity = async (wallet: SigningWallet): Promise<EmployerIdentity> => {
  try {
    const { signature } = await wallet.signData(SIGN_IN_MESSAGE, {
      encoding: 'text',
      keyType: 'unshielded',
    });
    if (typeof signature !== 'string' || signature.length < MIN_SIGNATURE_LENGTH) {
      throw new Error('wallet returned an unusable signature');
    }
    return {
      employerKey: await sha256('pay-equity:employer', signature),
      salt: await sha256('pay-equity:salt', signature),
      source: 'wallet-signature',
    };
  } catch (err) {
    return randomIdentity(describeError(err));
  }
};
