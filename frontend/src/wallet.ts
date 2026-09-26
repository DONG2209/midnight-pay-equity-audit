// SPDX-License-Identifier: Apache-2.0
//
// Thin wrapper around the Midnight DApp Connector API. A compatible wallet
// (e.g. Lace) injects itself under `window.midnight[<rdns>]` — see
// https://docs.midnight.network for the full connector spec. This module
// only *detects and connects* to a wallet; it deliberately does not submit
// any transaction, since that requires a contract already deployed to a
// live network (see README.md § "Going from sandbox to testnet").

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

export type DetectedWallet = {
  readonly rdns: string;
  readonly name: string;
  readonly icon: string;
  readonly apiVersion: string;
  readonly api: InitialAPI;
};

export const detectWallets = (): DetectedWallet[] => {
  const injected = window.midnight;
  if (!injected) return [];
  return Object.entries(injected).map(([rdns, api]) => ({
    rdns,
    name: api.name,
    icon: api.icon,
    apiVersion: api.apiVersion,
    api,
  }));
};

/**
 * Connects to a detected wallet, hinting the desired network.
 *
 * `networkId` follows the wallet connector convention (e.g. `'testnet'`,
 * `'undeployed'` for a local/standalone node). The wallet may prompt the
 * user to approve the connection.
 */
export const connectWallet = (wallet: DetectedWallet, networkId: string): Promise<ConnectedAPI> =>
  wallet.api.connect(networkId);

/** Network ids to offer in the UI. Which one your wallet is on is up to its own settings. */
export const NETWORK_IDS = ['preprod', 'preview', 'testnet', 'undeployed'] as const;

export type ConnectionSummary = {
  /** The network the wallet reports it's actually connected to, if it says. */
  readonly networkId?: string;
  /** The wallet's shielded address, if it will share it. */
  readonly shieldedAddress?: string;
};

/**
 * Best-effort read of what we're actually connected to. Both calls are
 * optional niceties for the UI — a wallet that refuses either still counts
 * as connected — so failures are swallowed rather than thrown.
 */
export const describeConnection = async (api: ConnectedAPI): Promise<ConnectionSummary> => {
  const [status, addresses] = await Promise.allSettled([
    api.getConnectionStatus(),
    api.getShieldedAddresses(),
  ]);
  return {
    networkId:
      status.status === 'fulfilled' && status.value.status === 'connected'
        ? status.value.networkId
        : undefined,
    shieldedAddress: addresses.status === 'fulfilled' ? addresses.value.shieldedAddress : undefined,
  };
};
