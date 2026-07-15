import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  // Netlify Database reads and applies migrations from this directory on
  // every production deploy and deploy preview.
  out: 'netlify/database/migrations',
  migrations: {
    // Timestamp prefixes keep hand-written data migrations (the seed) and
    // generated schema migrations in one lexicographic order.
    prefix: 'timestamp',
  },
});
