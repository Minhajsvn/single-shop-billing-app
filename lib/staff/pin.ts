// Till PINs: 4 digits, hashed on the device with PBKDF2-SHA256 so the server never sees a PIN.
// A PIN says who is at the till; it is not a security boundary (spec 2A §2.5). Works in the browser and in Node.

export const PIN_ITERATIONS = 100_000;
export const PIN_SALT_BYTES = 16;
export const PIN_HASH_BYTES = 32;

export function isValidPin(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function derive(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PIN_ITERATIONS }, key, PIN_HASH_BYTES * 8);
  return new Uint8Array(bits);
}

/** Hash a PIN with the given base64 salt, or a fresh random 16-byte salt. */
export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? fromBase64(saltB64) : globalThis.crypto.getRandomValues(new Uint8Array(PIN_SALT_BYTES));
  if (!salt) throw new RangeError("Salt must be base64.");
  return { hash: toBase64(await derive(pin, salt)), salt: toBase64(salt) };
}

/** Constant-time comparison of the derived bytes against the stored hash. */
export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const expected = fromBase64(hash);
  const saltBytes = fromBase64(salt);
  if (!expected || !saltBytes || expected.length !== PIN_HASH_BYTES) return false;
  const actual = await derive(pin, saltBytes);
  let diff = 0;
  for (let i = 0; i < PIN_HASH_BYTES; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
