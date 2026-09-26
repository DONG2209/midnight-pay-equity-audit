// SPDX-License-Identifier: Apache-2.0

/**
 * Turns whatever a wallet throws into readable text. The DApp Connector API
 * rejects with `{ type: 'DAppConnectorAPIError', code, reason }` objects (see
 * @midnight-ntwrk/dapp-connector-api's `APIError`), and `String(err)` on those
 * gives "[object Object]" or an empty message — useless when the point is to
 * tell someone why their wallet didn't connect.
 */
export const describeError = (err: unknown): string => {
  if (typeof err === 'object' && err !== null) {
    const { code, reason, message } = err as { code?: unknown; reason?: unknown; message?: unknown };
    const detail = [code, reason ?? message].filter((part): part is string => typeof part === 'string' && part !== '');
    if (detail.length > 0) return detail.join(': ');
  }
  return String(err);
};
