/**
 * Generate the ADMIN_PASSWORD_HASH environment variable value.
 *
 *   npm run hash-password            # prompts
 *   npm run hash-password -- 'pass'  # or pass as an argument
 *
 * Prints the scrypt hash to copy into Netlify as ADMIN_PASSWORD_HASH.
 */

import { scrypt, randomBytes } from 'node:crypto';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

let password = process.argv[2];
if (!password) {
  const rl = readline.createInterface({ input, output });
  password = await rl.question('Admin password (input is visible; use a private terminal): ');
  rl.close();
}

if (!password || password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}

const cost = { N: 16384, r: 8, p: 1 };
const salt = randomBytes(16);
scrypt(password, salt, 64, { ...cost, maxmem: 256 * 1024 * 1024 }, (err, key) => {
  if (err) throw err;
  const hash = ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64'), key.toString('base64')].join('$');
  console.log('\nSet this as ADMIN_PASSWORD_HASH in Netlify (mark it secret):\n');
  console.log(hash);
});
