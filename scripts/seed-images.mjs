/**
 * One-time upload of the seeded originals to the Netlify Blobs `images`
 * store. Run after the first production deploy:
 *
 *   netlify link                          # associates this repo with the site
 *   NETLIFY_AUTH_TOKEN=... npm run seed:images
 *
 * Credentials: the site ID comes from NETLIFY_SITE_ID or .netlify/state.json
 * (written by `netlify link`); the token comes from NETLIFY_AUTH_TOKEN (a
 * Netlify personal access token, per the Blobs docs for use outside
 * functions) or from the Netlify CLI's saved login if it can be found.
 *
 * This runs from a local machine because Netlify build plugins may only
 * write deploy-scoped blob stores, never the global `images` store the site
 * serves from.
 */

import { getStore } from '@netlify/blobs';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function resolveSiteId() {
  if (process.env.NETLIFY_SITE_ID) return process.env.NETLIFY_SITE_ID;
  const statePath = join(root, '.netlify/state.json');
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.siteId) return state.siteId;
  }
  return null;
}

function resolveToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  for (const p of [
    join(homedir(), '.config/netlify/config.json'),
    join(homedir(), '.netlify/config.json'),
    join(homedir(), 'Library/Preferences/netlify/config.json'),
  ]) {
    if (!existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf8'));
      const user = cfg.users?.[cfg.userId];
      if (user?.auth?.token) return user.auth.token;
    } catch {
      // unreadable CLI config; fall through to the error below
    }
  }
  return null;
}

const siteID = resolveSiteId();
const token = resolveToken();

if (!siteID || !token) {
  console.error(
    'seed-images: missing credentials.\n' +
      (siteID ? '' : '  - Site ID: run `netlify link` or set NETLIFY_SITE_ID.\n') +
      (token
        ? ''
        : '  - Token: set NETLIFY_AUTH_TOKEN to a personal access token\n' +
          '    (app.netlify.com > User settings > Applications > New access token).\n'),
  );
  process.exit(1);
}

const collection = JSON.parse(readFileSync(join(root, 'seed/collection.json'), 'utf8'));
const images = collection.pieces.flatMap((p) => p.images);

const store = getStore({ name: 'images', siteID, token, consistency: 'strong' });

let uploaded = 0;
for (const image of images) {
  const file = join(root, 'seed/images', image.blobKey.replace(/^pieces\//, ''));
  const body = readFileSync(file);
  await store.set(image.blobKey, new Blob([body], { type: 'image/jpeg' }));
  uploaded += 1;
  console.log(`  ${image.blobKey} (${body.length.toLocaleString()} bytes)`);
}

const { blobs } = await store.list({ prefix: 'pieces/' });
console.log(`\nUploaded ${uploaded} images; store now holds ${blobs.length} under pieces/.`);
if (blobs.length < uploaded) {
  console.error('seed-images: store listing is smaller than the upload set; investigate before relying on it.');
  process.exit(1);
}
