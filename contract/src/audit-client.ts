// SPDX-License-Identifier: Apache-2.0
//
// A thin, dependency-free client around the compiled contract, built directly
// on `@midnight-ntwrk/compact-runtime`. It runs the exact same compiled
// circuits a wallet/proof-server pipeline would run, just without a wallet,
// node, indexer, or proof server underneath — which makes it equally at home
// in:
//   - unit tests (see src/test/pay-equity.test.ts), and
//   - the browser verifier (see ../../frontend), for a fully client-side,
//     zero-infrastructure demo of the audit's logic and privacy model.
//
// Going from here to a real on-chain deployment means swapping this class for
// `@midnight-ntwrk/midnight-js-contracts`' `deployContract` /
// `findDeployedContract`, wired to a wallet, indexer, and proof server — see
// ../../scripts/deploy-preprod.ts and README.md § "Going to Preprod".

import {
  type ChargedState,
  type CircuitContext,
  type EncodedZswapLocalState,
  createCircuitContext,
  createConstructorContext,
  emptyZswapLocalState,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, type Ledger, ledger } from './managed/pay-equity/contract/index.js';
import {
  type CategoryPayroll,
  type PayEquityPrivateState,
  activeCategoryCount,
  padCategories,
  witnesses,
} from './witnesses.js';

/** A fixed, deterministic stand-in coin public key — fine off-chain. */
const SANDBOX_COIN_PUBLIC_KEY = '0'.repeat(64);

export class AuditClient {
  readonly contract: Contract<PayEquityPrivateState>;
  readonly contractAddress: string;
  readonly thresholdPercent: bigint;
  private contractState!: ChargedState;
  private zswapState!: EncodedZswapLocalState;
  private privateState!: PayEquityPrivateState;

  private constructor(
    contract: Contract<PayEquityPrivateState>,
    contractAddress: string,
    thresholdPercent: bigint,
  ) {
    this.contract = contract;
    this.contractAddress = contractAddress;
    this.thresholdPercent = thresholdPercent;
  }

  /** Deploys a fresh audit contract with the given compliance threshold (percent). */
  static async deploy(
    thresholdPercent: bigint,
    initialPrivateState: PayEquityPrivateState,
  ): Promise<AuditClient> {
    const client = new AuditClient(
      new Contract<PayEquityPrivateState>(witnesses),
      sampleContractAddress(),
      thresholdPercent,
    );
    const deployed = await client.contract.initialState(
      createConstructorContext(initialPrivateState, SANDBOX_COIN_PUBLIC_KEY),
      thresholdPercent,
    );
    client.contractState = deployed.currentContractState.data;
    client.zswapState = deployed.currentZswapLocalState;
    client.privateState = deployed.currentPrivateState;
    return client;
  }

  /** Points a second local party (e.g. a regulator/verifier) at the same state. */
  static joinExisting(other: AuditClient, privateState: PayEquityPrivateState): AuditClient {
    const client = new AuditClient(
      new Contract<PayEquityPrivateState>(witnesses),
      other.contractAddress,
      other.thresholdPercent,
    );
    client.contractState = other.contractState;
    client.zswapState = other.zswapState ?? emptyZswapLocalState(SANDBOX_COIN_PUBLIC_KEY);
    client.privateState = privateState;
    return client;
  }

  private async run<R>(
    circuitId: string,
    exec: (context: CircuitContext<PayEquityPrivateState>) => Promise<{
      result: R;
      context: {
        callContext: {
          currentQueryContext: { state: ChargedState };
          currentZswapLocalState?: EncodedZswapLocalState;
          currentPrivateState?: PayEquityPrivateState;
        };
      };
    }>,
  ): Promise<R> {
    const context = createCircuitContext(
      circuitId,
      this.contractAddress,
      this.zswapState,
      this.contractState,
      this.privateState,
    );
    const { result, context: after } = await exec(context);
    this.contractState = after.callContext.currentQueryContext.state;
    this.zswapState = after.callContext.currentZswapLocalState ?? this.zswapState;
    this.privateState = after.callContext.currentPrivateState ?? this.privateState;
    return result;
  }

  registerEmployer(): Promise<[]> {
    return this.run('registerEmployer', (context) =>
      this.contract.impureCircuits.registerEmployer(context),
    );
  }

  /**
   * Runs one confidential audit over the current private payroll. `threshold`
   * defaults to the threshold this contract was deployed with. Resolves once
   * the yes/no result and payroll commitment are on the (local) ledger.
   */
  submitAudit(period: string, threshold: bigint = this.thresholdPercent): Promise<[]> {
    const active = activeCategoryCount(this.privateState.payroll);
    return this.run('submitAudit', (context) =>
      this.contract.impureCircuits.submitAudit(context, period, active, threshold),
    );
  }

  /** Replaces the local payroll (e.g. to run a second period) without redeploying. */
  setPayroll(categories: readonly CategoryPayroll[]): void {
    this.privateState = { ...this.privateState, payroll: padCategories(categories) };
  }

  getLedger(): Ledger {
    return ledger(this.contractState);
  }

  getPrivateState(): PayEquityPrivateState {
    return this.privateState;
  }
}
