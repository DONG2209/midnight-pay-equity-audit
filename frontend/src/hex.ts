// SPDX-License-Identifier: Apache-2.0

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export const fromHex = (hex: string): Uint8Array => {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

export const shortHex = (bytes: Uint8Array, length = 10): string => `${toHex(bytes).slice(0, length)}…`;
