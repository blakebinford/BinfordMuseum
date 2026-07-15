// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

// Canonical/OpenGraph origin: the custom domain on production builds, the
// deploy's own URL on previews and branch deploys, localhost otherwise.
const site =
  process.env.CONTEXT === 'production'
    ? process.env.URL
    : (process.env.DEPLOY_PRIME_URL ?? process.env.URL ?? 'http://localhost:4321');

// Static output by default; admin routes and APIs opt into on-demand
// rendering with `export const prerender = false`.
export default defineConfig({
  site,
  adapter: netlify({
    // Keep middleware in the Node functions runtime (not edge) so the same
    // session-verification code runs at build time, in functions, and locally.
    edgeMiddleware: false,
  }),
});
