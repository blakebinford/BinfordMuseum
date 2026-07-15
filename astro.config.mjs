// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

// Static output by default; admin routes and APIs opt into on-demand
// rendering with `export const prerender = false`.
export default defineConfig({
  adapter: netlify({
    // Keep middleware in the Node functions runtime (not edge) so the same
    // session-verification code runs at build time, in functions, and locally.
    edgeMiddleware: false,
  }),
});
