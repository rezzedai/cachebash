/**
 * Trace utilities — UUID v7 generation for agent trace correlation.
 * Zero external dependencies — uses Node.js crypto module.
 */

import { randomBytes } from "node:crypto";

/**
 * Generate a UUID v7 (timestamp-ordered, RFC 9562).
 *
 * Layout (128 bits):
 *   48 bits  — unix_ts_ms (milliseconds since epoch)
 *    4 bits  — version (0b0111 = 7)
 *   12 bits  — rand_a
 *    2 bits  — variant (0b10)
 *   62 bits  — rand_b
 */
export function generateSpanId(): string {
  const now = Date.now();
  const rand = randomBytes(10); // 80 bits of randomness

  // Bytes 0-5: 48-bit timestamp (big-endian)
  const buf = Buffer.alloc(16);
  buf[0] = (now / 2 ** 40) & 0xff;
  buf[1] = (now / 2 ** 32) & 0xff;
  buf[2] = (now / 2 ** 24) & 0xff;
  buf[3] = (now / 2 ** 16) & 0xff;
  buf[4] = (now / 2 ** 8) & 0xff;
  buf[5] = now & 0xff;

  // Bytes 6-7: version (4 bits) + rand_a (12 bits)
  buf[6] = 0x70 | (rand[0] & 0x0f); // version 7
  buf[7] = rand[1];

  // Bytes 8-15: variant (2 bits) + rand_b (62 bits)
  buf[8] = 0x80 | (rand[2] & 0x3f); // variant 10
  buf[9] = rand[3];
  buf[10] = rand[4];
  buf[11] = rand[5];
  buf[12] = rand[6];
  buf[13] = rand[7];
  buf[14] = rand[8];
  buf[15] = rand[9];

  // Format as 8-4-4-4-12 hex string
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
