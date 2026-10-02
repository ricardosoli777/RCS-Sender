import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const COST = 131_072;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 32;
const MAX_MEMORY = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, {
      N: cost,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
      maxmem: MAX_MEMORY
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw new Error('A senha deve ter entre 12 e 1024 bytes');
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return ['v1', 'scrypt', COST, BLOCK_SIZE, PARALLELIZATION, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (Buffer.byteLength(password, 'utf8') > 1024) return false;
  const parts = encoded.split('$');
  if (parts.length !== 7 || parts[0] !== 'v1' || parts[1] !== 'scrypt' || parts[2] !== String(COST)
    || parts[3] !== String(BLOCK_SIZE) || parts[4] !== String(PARALLELIZATION)) return false;
  const salt = Buffer.from(parts[5]!, 'base64url');
  const expected = Buffer.from(parts[6]!, 'base64url');
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = await derive(password, salt, COST);
  return timingSafeEqual(actual, expected);
}
