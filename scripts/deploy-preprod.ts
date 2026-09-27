// SPDX-License-Identifier: Apache-2.0
//
// Deploy the Confidential Pay-Equity Audit contract to Midnight Preprod.
//
// This is the ONE step the in-browser sandbox (frontend/) and the test suite
// deliberately stop short of, because it needs infrastructure that can't live
// in a browser tab or a CI runner: a funded wallet, a local proof server, and
// an indexer. Everything else in this repo — the contract, its circuits, the
// commitment scheme, the compliance logic — is exactly what runs here.
//
// ─────────────────────────────────────────────────────────────────────────────
// PREREQUISITES
//
//   1. Proof server (runs LOCALLY — it sees your private payroll in cleartext):
//        docker run -p 6300:6300 midnightnetwork/proof-server -- \
//          'midnight-proof-server --network preprod'
//
//   2. A Preprod wallet seed in .env.preprod (this file is git-ignored):
//        WALLET_SEED=<64-hex-char seed>
//      Fund it: request tNIGHT from the faucet, then register it for tDUST
//      generation in your wallet.
//        Faucet:  https://midnight-tmnight-preprod.nethermind.dev/
//
//   3. Build the full ZK artifacts (proving/verifying keys) once — the sandbox
//      build skips these for speed:
//        npm run compact:zk --workspace contract
//
//   4. Install the deploy-only dependencies (kept out of the app's package.json
//      so the browser bundle and CI stay lean). Pin to the versions in your
//      support matrix — this repo was written against midnight-js 4.1.1:
//        npm i -D \
//          @midnight-ntwrk/midnight-js-contracts@4.1.1 \
//          @midnight-ntwrk/midnight-js-types@4.1.1 \
//          @midnight-ntwrk/midnight-js-network-id@4.1.1 \
//          @midnight-ntwrk/midnight-js-indexer-public-data-provider@4.1.1 \
//          @midnight-ntwrk/midnight-js-node-zk-config-provider@4.1.1 \
//          @midnight-ntwrk/midnight-js-http-client-proof-provider@4.1.1 \
//          @midnight-ntwrk/midnight-js-level-private-state-provider@4.1.1 \
//          @midnight-ntwrk/wallet @midnight-ntwrk/wallet-api \
//          @midnight-ntwrk/zswap tsx dotenv
//
//   5. Run it:
//        npx tsx --env-file=.env.preprod scripts/deploy-preprod.ts
//
// PREPROD ENDPOINTS (https://docs.midnight.network/guides/networks-and-environments)
//   Indexer   : https://indexer.preprod.midnight.network/api/v4/graphql
//   Indexer WS: wss://indexer.preprod.midnight.network/api/v4/graphql/ws
//   Node RPC  : https://rpc.preprod.midnight.network
//   Proof srv : http://localhost:6300
//
// A NOTE ON VERSIONS: midnight-js is pre-1.0 and its wallet-construction and
// provider APIs move between releases. The DEPLOY block below follows the
// current Bulletin Board tutorial (docs.midnight.network/tutorials/bboard) and
// the midnightntwrk/example-bboard repo — cross-check the parts marked
// "VERIFY" against the example for the exact version in your package-lock if an
// import path or option name has drifted. The contract itself, imported straight
// from the built package, does not change.
//
// This file is intentionally NOT part of the app's tsconfig `include`, so the
// deploy-only imports don't need to be installed for `npm run build`/`test`.

/* eslint-disable */
// @ts-nocheck

import { webcrypto } from 'node:crypto';

import { setNetworkId, NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';

// The contract, its witnesses, and the local client — from THIS repo.
import {
  AuditClient,
  Contract,
  createEmployerPrivateState,
  witnesses,
  type CategoryPayroll,
} from '../contract/src/index.js';

// ── Configuration ────────────────────────────────────────────────────────────

setNetworkId(NetworkId.Preprod ?? ('preprod' as any));

const CONFIG = {
  indexer: process.env.INDEXER_URI ?? 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: process.env.INDEXER_WS_URI ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: process.env.NODE_URI ?? 'https://rpc.preprod.midnight.network',
  proofServer: process.env.PROOF_SERVER_URI ?? 'http://localhost:6300',
  zkConfigPath: new URL('../contract/src/managed/pay-equity', import.meta.url).pathname,
  privateStateStoreName: 'pay-equity',
  privateStateId: 'pay-equity',
};

const THRESHOLD_PERCENT = 5n;
const REPORTING_PERIOD = process.env.REPORTING_PERIOD ?? '2027-H1';

// ── The payroll to audit (PRIVATE — stays on this machine) ───────────────────
// Averages × counts, entered as salary totals + head counts per gender. Only the
// yes/no verdict and a commitment ever go on chain.
const PAYROLL: CategoryPayroll[] = [
  { manTotal: 1_104_000n, manCount: 12n, womanTotal: 720_000n, womanCount: 8n }, // Engineering
  { manTotal: 420_000n, manCount: 6n, womanTotal: 612_000n, womanCount: 9n }, //    Sales
  { manTotal: 220_000n, manCount: 4n, womanTotal: 540_000n, womanCount: 10n }, //   Support
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const seed = required('WALLET_SEED');
  const employerKey = await deriveEmployerKey(seed);
  const salt = await deriveSalt(seed);
  const initialPrivateState = createEmployerPrivateState(employerKey, PAYROLL, salt);

  // 1) Local preflight (real circuits, no chain), so an obviously non-compliant
  //    payroll never wastes a real deploy.
  const preflight = await AuditClient.deploy(THRESHOLD_PERCENT, initialPrivateState);
  await preflight.registerEmployer();
  await preflight.submitAudit(REPORTING_PERIOD, THRESHOLD_PERCENT);
  console.log(`Preflight (local): compliant = ${preflight.getLedger().lastCompliant}`);

  // 2) Real Preprod deploy.
  const wallet = await buildWallet(seed); // VERIFY: see header note on versions
  try {
    const zkConfigProvider = new NodeZkConfigProvider<'registerEmployer' | 'submitAudit'>(
      CONFIG.zkConfigPath,
    );

    const providers = {
      privateStateProvider: levelPrivateStateProvider({
        privateStateStoreName: CONFIG.privateStateStoreName,
        signingKeyStoreName: `${CONFIG.privateStateStoreName}-signing-keys`,
        privateStoragePasswordProvider: () => required('PRIVATE_STORE_PASSWORD'), // 16+ chars
        accountId: seed,
      }),
      publicDataProvider: indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS),
      zkConfigProvider,
      proofProvider: httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
      // MidnightWalletProvider implements both WalletProvider and MidnightProvider.
      walletProvider: wallet.provider,
      midnightProvider: wallet.provider,
    };

    const deployed = await deployContract(providers, {
      contract: new Contract(witnesses),
      privateStateId: CONFIG.privateStateId,
      initialPrivateState,
      args: [THRESHOLD_PERCENT], // constructor(threshold)
    });

    const address = deployed.deployTxData.public.contractAddress;
    console.log(`\n✅ Deployed to Preprod: ${address}`);
    console.log(`   Explorer: https://midnightexplorer.com/  (search this address)\n`);

    // 3) File the first audit on chain.
    await deployed.callTx.registerEmployer();
    const active = BigInt(PAYROLL.length);
    await deployed.callTx.submitAudit(REPORTING_PERIOD, active, THRESHOLD_PERCENT);
    console.log(`Audit filed on chain for period ${REPORTING_PERIOD}.`);

    console.log(`\nNext: paste this into frontend/.env and the README:`);
    console.log(`  VITE_CONTRACT_ADDRESS=${address}`);
  } finally {
    await wallet.close?.();
  }
}

// ── Wallet construction (VERIFY against example-bboard for your version) ──────
// Follows the current tutorial: FluentWalletBuilder from a seed, wait for funds,
// then a MidnightWalletProvider that balances/signs/submits transactions.
async function buildWallet(seed: string) {
  const { FluentWalletBuilder } = await import('@midnight-ntwrk/wallet');
  const builder = FluentWalletBuilder.forEnvironment({
    indexer: CONFIG.indexer,
    indexerWS: CONFIG.indexerWS,
    node: CONFIG.node,
    proofServer: CONFIG.proofServer,
    networkId: 'preprod',
  });
  const { wallet } = await builder.withSeed(seed).buildWithoutStarting();
  wallet.start();

  // Wait until the wallet has synced and has funds to pay fees.
  await waitForFunds(wallet);

  // The example wraps `wallet` in a MidnightWalletProvider that implements both
  // WalletProvider (coinPublicKey + balanceTx) and MidnightProvider (submitTx).
  // Import path / class name may differ by version — grep example-bboard's
  // `common-types`/`api` for `MidnightWalletProvider`.
  const { MidnightWalletProvider } = await import('@midnight-ntwrk/wallet');
  const provider = await MidnightWalletProvider.build(wallet);

  return {
    provider,
    close: async () => {
      await wallet.close?.();
    },
  };
}

async function waitForFunds(wallet: any): Promise<void> {
  // The wallet exposes an RxJS `state$` stream; wait for a non-zero balance.
  await new Promise<void>((resolve) => {
    const sub = wallet.state().subscribe((s: any) => {
      const balance = s?.balances?.[Object.keys(s.balances ?? {})[0]] ?? 0n;
      if (balance && BigInt(balance) > 0n) {
        sub.unsubscribe?.();
        resolve();
      }
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (see the header of this file)`);
  return v;
}

// The employer key and salt are derived deterministically from the wallet seed
// (SHA-256 with a domain tag), mirroring how the frontend derives them from a
// wallet signature — so re-running with the same seed reproduces the same
// employer identity and payroll commitment.
async function sha256(tag: string, seed: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`${tag}\u0000${seed}`);
  return new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
}
const deriveEmployerKey = (seed: string) => sha256('pay-equity:employer', seed);
const deriveSalt = (seed: string) => sha256('pay-equity:salt', seed);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
