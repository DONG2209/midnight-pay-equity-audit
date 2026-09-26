// SPDX-License-Identifier: Apache-2.0
//
// Drives the real index.html + main.ts in jsdom with a fake Midnight wallet on
// `window.midnight`, and the REAL compiled contract underneath — the closest
// thing to clicking through the live demo without a browser.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The DOM comes from a hand-made JSDOM instance rather than vitest's
// `environment: 'jsdom'`: that mode also swaps in jsdom's realm of typed-array
// constructors, and the compiled contract's WASM runtime (loaded by Node) then
// rejects our `Uint8Array` keys as "expected byte array". Only window/document
// are needed here, so leave every other global alone.
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const bodyMarkup = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[^>]*><\/script>/g, '');

const SIGNATURE = 'cd'.repeat(64);

type FakeWalletOptions = {
  signData?: () => Promise<{ signature: string }>;
  /** Replaces the whole connect() — e.g. to reject, or to never answer. */
  connect?: (networkId: string) => Promise<unknown>;
};

let pendingWallet: unknown;

/** Queues a fake wallet; it is put on `window.midnight` when the app boots. */
const installFakeWallet = ({ signData, connect }: FakeWalletOptions = {}) => {
  pendingWallet = {
    'fake.lace': {
      rdns: 'fake.lace',
      name: 'Fake Lace',
      icon: '',
      apiVersion: '4.0.1',
      connect:
        connect ??
        (async (networkId: string) => ({
          getConnectionStatus: async () => ({ status: 'connected', networkId }),
          getShieldedAddresses: async () => ({
            shieldedAddress: 'mn_shield-addr_preprod1qqqqqqqqqqqqqqqqqqqqqqq',
            shieldedCoinPublicKey: 'pk',
            shieldedEncryptionPublicKey: 'epk',
          }),
          signData: signData ?? (async () => ({ signature: SIGNATURE })),
        })),
    },
  };
};

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const click = (id: string) => el(id).click();
const text = (id: string) => el(id).textContent ?? '';
const logText = () => text('log-list');

let dom: JSDOM;

const bootApp = async () => {
  dom = new JSDOM(`<!doctype html><html><body>${bodyMarkup}</body></html>`);
  if (pendingWallet) (dom.window as unknown as { midnight: unknown }).midnight = pendingWallet;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  vi.resetModules();
  await import('./main.js');
};

const connectFakeWallet = async () => {
  click('detect-wallet-btn');
  (el('wallet-list').querySelector('button') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(el<HTMLButtonElement>('run-audit-btn').disabled).toBe(false));
};

/** Sets a number input in a payroll row and fires the input event main.ts listens for. */
const setCell = (rowIdx: number, inputIdx: number, value: string) => {
  const row = el('category-rows').querySelectorAll('tr')[rowIdx];
  const input = row.querySelectorAll('input')[inputIdx] as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input'));
};

beforeEach(() => {
  pendingWallet = undefined; // each test starts with no wallet installed
});

afterEach(() => {
  dom?.window.close();
});

describe('verifier app', () => {
  it('starts locked: the audit cannot run before a wallet is connected', async () => {
    await bootApp();

    expect(el<HTMLButtonElement>('run-audit-btn').disabled).toBe(true);
    expect(el('gate-hint').hidden).toBe(false);
  });

  it('reports when no Midnight wallet is installed (e.g. only Freighter/MetaMask)', async () => {
    await bootApp();

    click('detect-wallet-btn');

    expect(text('wallet-status')).toContain('no compatible wallet');
    expect(el<HTMLButtonElement>('run-audit-btn').disabled).toBe(true);
  });

  it('seeds an editable payroll and previews compliance locally', async () => {
    await bootApp();

    const rows = el('category-rows').querySelectorAll('tr');
    expect(rows.length).toBe(3);
    expect(text('preview-line')).toContain('COMPLIANT');
  });

  it('connects a wallet, derives the employer key, and unlocks the audit', async () => {
    installFakeWallet();
    await bootApp();

    await connectFakeWallet();

    expect(text('wallet-status')).toContain('connected to Fake Lace');
    expect(text('wallet-details')).toContain('Network: preprod');
    expect(logText()).toContain('Employer key derived from your wallet signature');
    expect(el('gate-hint').hidden).toBe(true);
  });

  it('runs a real confidential audit and publishes COMPLIANT for a within-limit payroll', async () => {
    installFakeWallet();
    await bootApp();
    await connectFakeWallet();

    click('run-audit-btn');
    await vi.waitFor(() => expect(el('result-card').hidden).toBe(false));
    await vi.waitFor(() => expect(text('verdict-badge')).toContain('COMPLIANT'));

    expect(text('verdict-badge')).not.toContain('NOT COMPLIANT');
    expect(text('observer-view')).toContain('"lastCompliant": true');
    expect(text('res-categories')).toBe('3');
  });

  it('never writes a salary to the public ledger the observer sees', async () => {
    installFakeWallet();
    await bootApp();
    await connectFakeWallet();

    click('run-audit-btn');
    await vi.waitFor(() => expect(text('verdict-badge')).toContain('COMPLIANT'));

    // 92000 is the seeded Engineering men's average — it must not appear anywhere
    // in the public ledger dump.
    expect(text('observer-view')).not.toContain('92000');
    expect(text('observer-view')).not.toContain('90000');
  });

  it('publishes NOT COMPLIANT once the payroll breaches the 5% limit', async () => {
    installFakeWallet();
    await bootApp();
    await connectFakeWallet();

    // Drop Engineering women's average far below the men's -> a large gap.
    setCell(0, 4, '50000');
    expect(text('preview-line')).toContain('NOT COMPLIANT');

    click('run-audit-btn');
    await vi.waitFor(() => expect(text('verdict-badge')).toContain('NOT COMPLIANT'));
    expect(text('observer-view')).toContain('"lastCompliant": false');
  });

  it('still unlocks, with a visible warning, if the wallet refuses to sign', async () => {
    installFakeWallet({
      signData: async () => {
        throw new Error('User rejected the request');
      },
    });
    await bootApp();

    await connectFakeWallet();

    expect(logText()).toContain('Wallet signing unavailable');
  });

  it('shows a wallet rejection right in the wallet card, not just in the log', async () => {
    installFakeWallet({
      connect: async () => {
        // The shape the DApp Connector API rejects with (see its APIError type).
        throw Object.assign(new Error(''), { code: 'Rejected', reason: 'User declined the connection' });
      },
    });
    await bootApp();

    click('detect-wallet-btn');
    (el('wallet-list').querySelector('button') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(text('wallet-status')).toContain('connection failed: Rejected: User declined'));
    expect(el('wallet-status').classList.contains('err')).toBe(true);
    expect(el<HTMLButtonElement>('run-audit-btn').disabled).toBe(true);
  });

  it('says it is waiting for the wallet while the connect prompt is still open', async () => {
    installFakeWallet({ connect: () => new Promise(() => {}) }); // never answered

    await bootApp();
    click('detect-wallet-btn');
    const connectBtn = el('wallet-list').querySelector('button') as HTMLButtonElement;
    connectBtn.click();

    expect(text('wallet-status')).toContain('waiting for Fake Lace');
    expect(text('wallet-status')).toContain('"preprod"');
    expect(connectBtn.disabled).toBe(true);
  });

  it('demo mode unlocks and runs an audit without any wallet', async () => {
    await bootApp();

    click('demo-mode-btn');
    expect(text('wallet-status')).toContain('demo mode');
    expect(el<HTMLButtonElement>('run-audit-btn').disabled).toBe(false);

    click('run-audit-btn');
    await vi.waitFor(() => expect(el('result-card').hidden).toBe(false));
    await vi.waitFor(() => expect(text('verdict-badge')).toContain('COMPLIANT'));
  });
});
