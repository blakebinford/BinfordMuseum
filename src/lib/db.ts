import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from '../../db/schema';

export * as tables from '../../db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let instance: Db | null = null;

/**
 * Lazy Drizzle client on the Netlify Database driver. The connection is
 * resolved from the platform-injected NETLIFY_DB_URL (builds, functions, and
 * the local dev database under `netlify dev`), so importing this module never
 * requires configuration -- but it also never opens a connection until a
 * query actually runs, which keeps database-free pages buildable anywhere.
 */
export function getDb(): Db {
  instance ??= drizzle({ schema });
  return instance;
}

export function hasDatabase(): boolean {
  return Boolean(process.env.NETLIFY_DB_URL);
}
