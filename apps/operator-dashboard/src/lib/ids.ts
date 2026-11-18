// Crockford base32: no I, L, O, U. Matches the id patterns in shared/schemas/common.schema.json.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID (48-bit ms time + 80 random bits, 26 chars) with a `prefix_`. */
export function newId(prefix: string): string {
  let time = Date.now();
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let rand = 0n;
  for (const b of bytes) rand = (rand << 8n) | BigInt(b);
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart = ALPHABET[Number(rand & 31n)] + randPart;
    rand >>= 5n;
  }
  return `${prefix}_${timePart}${randPart}`;
}
