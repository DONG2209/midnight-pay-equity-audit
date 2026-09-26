// SPDX-License-Identifier: Apache-2.0
//
// Deploy the Confidential Pay-Equity Audit contract to Midnight Preprod.
//
// This is the ONE step the in-browser sandbox (frontend/) and the test suite
// deliberately stop short of, because it needs infrastructure that can't live
// in a browser tab or a CI runner: a funded wallet, a proof server, and an
// indexer. Everything else in this repo — the contract, its circuits, the
// commitment scheme, the compliance logic — is exactly what runs here.
//
// ─────────────────────────────────────────────────────────────────────────────
// PREREQUISITES (see README.md § "Going to Preprod" for the full walkthrough)
//   1. A proof server reachable at $PROOF_SERVER_URI, e.g. run locally:
//        docker run -p 6300:6300 midnightnetwork/proof-server -- \
//          'midnight-proof-server --network preprod'
//   2. A Preprod indexer (public data provider) at $INDEXER_URI / $INDEXER_WS_URI.
//   3. A funded Preprod wallet seed in $WALLET_SEED (get tДN from the faucet).
//   4. Install the deploy-only dependencies (kept out of the app's package.json
//      so the browser bundle and CI stay lean):
//        npm i -D @midnight-ntwrk/midnight-js-contracts \
//                 @midnight-ntwrk/midnight-js-node-zk-config-provider \
//                 @midnight-ntwrk/midnight-js-indexer-public-data-provider \
//                 @midnight-ntwrk/midnight-js-http-client-proof-provider \
//                 @midnight-ntwrk/midnight-js-level-private-state-provider \
//                 @midnight-ntwrk/wallet @midnight-ntwrk/wallet-api tsx
//   5. Build the full ZK artifacts (proving/verifying keys) once — the sandbox
//      build skips these for speed:
//        npm run compact:zk --workspace contract
//   6. Run it:
//        npx tsx scripts/deploy-preprod.ts
//
// The provider stack below follows Midnight's own examples (Bulletin Board /
// Counter tutorials at https://docs.midnight.network). This SDK is pre-1.0 and
// its provider constructors move between releases: if an import path or option
// name here has drifted by the time you run it, cross-check it against the
// tutorial for the midnight-js version in your package-lock and adjust. The
// contract itself — imported straight from the built package — does not change.
//
// This file is intentionally NOT part of the app's tsconfig `include`, so the
// commented-out imports don't need to be installed for `npm run build`/`test`.

/* eslint-disable */
// @ts-nocheck

import { AuditClient, createEmployerPrivateState, type CategoryPayroll } from '../contract/src/index.js';

// --- The payroll to audit. Fill in from your real (private) HR data. ---------
// Averages are in whole currency units per year; counts are head counts. This
// data stays on THIS machine — only the yes/no result and a commitment go on
// chain.
const THRESHOLD_PERCENT = 5n;
const REPORTING_PERIOD = process.env.REPORTING_PERIOD ?? '2027-H1';

const PAYROLL: CategoryPayroll[] = [
  { manTotal: 1_104_000n, manCount: 12n, womanTotal: 720_000n, womanCount: 8n }, // Engineering
  { manTotal: 420_000n, manCount: 6n, womanTotal: 612_000n, womanCount: 9n }, //    Sales
  { manTotal: 220_000n, manCount: 4n, womanTotal: 540_000n, womanCount: 10n }, //   Support
];

async function main() {
  // Local-simulator sanity check first, so an obviously non-compliant payroll
  // never wastes a real deploy. (This runs the exact circuits, off chain.)
  const seed = required('WALLET_SEED');
  const employerKey = deriveEmployerKey(seed);
  const preflight = await AuditClient.deploy(
    THRESHOLD_PERCENT,
    createEmployerPrivateState(employerKey, PAYROLL),
  );
  await preflight.registerEmployer();
  await preflight.submitAudit(REPORTING_PERIOD, THRESHOLD_PERCENT);
  console.log(`Preflight (local): compliant = ${preflight.getLedger().lastCompliant}`);

  // --- Real Preprod deploy. Uncomment once the deps in the header are installed.
  //
  // import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
  // import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
  // import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
  // import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
  // import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
  // import { witnesses } from '../contract/src/witnesses.js';
  //
  // const providers = {
  //   publicDataProvider: indexerPublicDataProvider(required('INDEXER_URI'), required('INDEXER_WS_URI')),
  //   proofProvider: httpClientProofProvider(required('PROOF_SERVER_URI')),
  //   zkConfigProvider: new NodeZkConfigProvider('contract/src/managed/pay-equity'),
  //   privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: 'pay-equity' }),
  //   // walletProvider + midnightProvider come from a @midnight-ntwrk/wallet built
  //   // from WALLET_SEED on 'preprod' — see the tutorial for the current wiring.
  // };
  //
  // const deployed = await deployContract(providers, {
  //   privateStateId: 'pay-equity',
  //   contract: new Contract(witnesses),
  //   initialPrivateState: createEmployerPrivateState(employerKey, PAYROLL),
  //   args: [THRESHOLD_PERCENT],
  // });
  // const address = deployed.deployTxData.public.contractAddress;
  // console.log(`Deployed to Preprod: ${address}`);
  // // Then: registerEmployer() and submitAudit(REPORTING_PERIOD, THRESHOLD_PERCENT)
  // // via deployed.callTx, and paste `address` into frontend/.env + the README.
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (see the header of this file)`);
  return v;
}

// Placeholder key derivation for the preflight. In production the employer key
// is derived from the wallet signature exactly as the frontend does
// (frontend/src/identity.ts); here we just need a deterministic 32 bytes.
function deriveEmployerKey(seed: string): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < seed.length && i < 32; i++) key[i] = seed.charCodeAt(i) & 0xff;
  return key;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
