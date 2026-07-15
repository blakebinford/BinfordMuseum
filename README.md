# The Gulf Coast Collection

A private collection of Texana, presented two ways:

- **Public gallery** – a museum-style walkthrough of six rooms at `/`, a browsable catalog at `/catalog`, and a shareable page per piece at `/piece/[accession]`.
- **Collection archive** – a password-protected admin area at `/admin` where the owner catalogs pieces, records acquisitions and condition, runs AI-assisted intake and valuation research, and controls what the public sees.

The design prototype and content source of record is `docs/gulf-coast-collection.html`. It is a design reference only and is never served as a page.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Astro 6 (`astro@^6.4.8`) with the official Netlify adapter `@astrojs/netlify@^7` |
| Rendering | Static (prerendered) public pages; per-route `prerender = false` for admin and APIs |
| Database | Netlify Database (managed Postgres) with Drizzle ORM (`drizzle-orm@beta`, the release line that ships the `drizzle-orm/netlify-db` adapter) |
| Migrations | Netlify Database platform-managed migrations in `netlify/database/migrations`, applied automatically on production deploys and deploy previews |
| Image originals | Netlify Blobs (`images` store) |
| Image derivatives | Netlify Image CDN (`/.netlify/images`) |
| AI | Anthropic API (current Claude Sonnet model) via `ANTHROPIC_API_KEY` |
| Node | 22.22.2, pinned in `netlify.toml` (`[build.environment] NODE_VERSION`) |

### Docs verification notes (July 2026)

Decisions below were verified against current Netlify documentation (`docs.netlify.com/llms.txt` index) and the Netlify agent skills repo (`github.com/netlify/context-and-tools`):

- **Adapter pairing**: `@astrojs/netlify@8` requires Astro 7; **`@astrojs/netlify@7` is the major that pairs with Astro 6** (`peerDependencies: astro ^6.0.0`) and is what this project uses.
- **Astro output**: Astro's old `hybrid` output mode no longer exists. This project uses the default static output with per-route `export const prerender = false` for on-demand rendering. On Netlify, on-demand routes run as Netlify Functions.
- **Netlify Database** is provisioned by the platform when the `@netlify/database` package is present. The connection is automatic (`NETLIFY_DB_URL` is injected into builds and functions; the Drizzle `netlify-db` driver picks it up without configuration). Deploy previews automatically get their own database branch forked from production data; production deploys are the only deploys that touch the main database.
- **Migrations** live in `netlify/database/migrations` (`<number>_<slug>` naming) and are applied automatically: on deploy previews before the preview goes live, and on production deploys immediately before publishing. Seed data ships as DML migrations per the Netlify Database skill ("Test rows and defaults become DML migrations, not ad-hoc inserts").
- **Drizzle**: the Netlify driver exists only on the beta release line, so this project pins `drizzle-orm@beta` and `drizzle-kit@beta` (per the netlify-database skill; the `latest` line lacks `drizzle-orm/netlify-db`).
- **Blobs**: build plugins may only *write* deploy-scoped stores, so seeding the global `images` store is done from a local script (authenticated via the Netlify CLI / personal access token), not from the build.
- **`[build.environment]` variables reach builds only** — runtime secrets must be set in the Netlify UI/CLI so Functions receive them.
- **AI Gateway**: Netlify's AI Gateway can inject `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` automatically on credit-based plans, which would remove key management entirely. However, it does not pass through request headers, caps context at 200k tokens, and its support for Anthropic's server-side web search tool (required by the valuation flow) is not documented. This project therefore uses the owner's own `ANTHROPIC_API_KEY`; per current docs, Netlify never overrides a key you set yourself. If you later prefer the Gateway for the intake flow only, remove your key and the official SDK picks up the Gateway automatically.
- **Authentication**: Netlify Identity's February 2025 deprecation was reversed on February 19, 2026; Identity continues as a supported option, and an Auth0 extension exists for heavier needs. For a single administrator, this project implements the minimal credential approach specified for it (env-var password hash + signed HTTP-only session cookie + middleware guard + login rate limiting). Tradeoff: Identity would add hosted email flows (invites, recovery) at the cost of a JS widget, dashboard configuration, and role-mapping indirection that a one-user archive does not need; the minimal approach keeps the entire surface in this repo. If you ever want multiple users or password recovery by email, revisit Identity.

> **Plan requirement**: Netlify Database is available on **credit-based plans only**, and **database storage billing is active** (the free-storage period ended July 1, 2026). Confirm your Netlify plan supports Netlify Database before the first deploy.

## Environment variables

Set these in the Netlify UI (Project configuration → Environment variables) or via `netlify env:set`. They are runtime secrets; do not put them in `netlify.toml` and do not commit them.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI intake and valuation research |
| `SESSION_SECRET` | Long random string used to sign the admin session cookie (`openssl rand -hex 32`) |
| `ADMIN_PASSWORD_HASH` | scrypt hash of the admin password (generate with `npm run hash-password`, added in Phase 4) |
| `BUILD_HOOK_URL` | Netlify build hook URL; publishing from the admin POSTs to it to rebuild the public site |

The database connection (`NETLIFY_DB_URL`) is provisioned and injected by the platform; you never set it yourself.

## Owner setup path (GitHub → Netlify)

1. Create the GitHub repository and push this project to it.
2. In Netlify, **Add new project → Import an existing project**, pick the repo. Build settings are read from `netlify.toml` (command `npm run build`, publish `dist`).
3. Confirm the team is on a credit-based plan that supports Netlify Database (see plan note above).
4. Set the environment variables listed above.
5. First deploy. The presence of `@netlify/database` provisions the database, and migrations in `netlify/database/migrations` (schema + seed rows) apply automatically before the deploy is published.
6. Run the one-time image seed from your machine (uploads the 25 prototype images to the Blobs `images` store): `netlify login`, `netlify link`, then `npm run seed:images` (added in Phase 2).
7. Create a build hook (Project configuration → Build & deploy → Continuous deployment → Build hooks), name it e.g. `admin-publish`, and set its URL as `BUILD_HOOK_URL`.
8. Connect the custom domain (Domain management → Add a domain).

## Local development

```sh
npm install
npm run dev
```

Astro 6 with the Netlify adapter emulates Netlify locally (functions, blobs, image CDN, environment) through the Netlify Vite plugin, so `npm run dev` is enough for most work. Database-backed pages need a database: use `netlify dev` (local Postgres-compatible database; apply migrations with `npm run db:migrate`). Netlify itself applies migrations to hosted databases; never run them against production by hand.

### Seed pipeline

The seed is split in two because Netlify build plugins may only write deploy-scoped blob stores:

1. **Rows** — `scripts/extract-prototype.mjs` parses `docs/gulf-coast-collection.html` verbatim (23 pieces, 6 rooms, 25 images with measured dimensions) and emits both `seed/collection.json` and the DML migration `netlify/database/migrations/20260715150000_seed_collection/`. Because it ships as a platform migration, it reaches the production database on first deploy, and deploy-preview database branches behave correctly (they fork production data, and a preview created before production was seeded still applies the migration itself). The script is deterministic and re-runnable; the migration is committed and must not be edited by hand.
2. **Image originals** — `npm run seed:images` uploads `seed/images/*` to the global Blobs `images` store under `pieces/<accession>-<kind>.jpg`, exactly the `blob_key` values the migration wrote. Run once from your machine after the first deploy (`netlify link`, then `NETLIFY_AUTH_TOKEN=<personal access token> npm run seed:images`).

Schema changes later: edit `db/schema.ts`, run `npm run db:generate` (drizzle-kit, timestamp-prefixed output into `netlify/database/migrations`), test locally with `npm run db:migrate`, commit both. Netlify applies them to previews and production automatically.

To run a build against your own Postgres (as CI for the migrations, or to preview real database content locally):

```sh
NETLIFY_DB_URL="postgresql://user@host/db" NETLIFY_DB_DRIVER=server npm run build
```

`NETLIFY_DB_DRIVER=server` selects the standard `pg` pool; without it, the Netlify Database driver assumes the platform's serverless (Neon HTTP) endpoint. On Netlify itself, neither variable is ever set by hand.

## Public site notes

- The walkthrough at `/` is prerendered from the database and reproduces the prototype exactly. A build-time structural check during development compared the rendered output figure-by-figure with `docs/gulf-coast-collection.html`: all 23 pieces verbatim (accession, title, meta, label, placement classes), trio/pair cabinet groupings, all six room headers and wall texts, entry/exit copy, storm-room treatment, Turn Over on the two reverse pieces only, and no em dashes anywhere.
- Placement rhythm (`pl/pr/pc` + `wide/std/sm`, trio and pair cabinets) is presentation, mapped per room in `src/pages/index.astro`; pieces added to a room beyond the prototype's slots alternate left/right. The storm treatment is keyed to Room IV.
- Two navigation affordances were added for the pages the spec adds beyond the prototype, styled entirely from existing tokens: a "View Piece Page" action in the lightbox, and a "Browse the Catalog" link in the exit section. Piece and catalog pages reuse the masthead with the brand linking home.
- Original images are served by the on-demand route `/img/<blob key>` from the Blobs `images` store (with a fallback to the committed `seed/images/` copies so local dev works before the blob seed has run); all rendered `<img>` sources go through the Netlify Image CDN (`/.netlify/images`) for derivatives and format negotiation. The route only serves keys under `pieces/` and rejects traversal.
- The privacy rule is enforced structurally in `src/lib/public-data.ts`: it is the only data source for public pages, and its queries name allowed columns explicitly. Prices, sellers, valuations, condition reports, research notes, and non-public provenance are never selected. Built output is additionally checked to contain none of those fields.

## Project phases

- [x] **Phase 1** – docs verification, scaffold, deployable hello page
- [x] **Phase 2** – database schema, migrations, Blobs, seed from the prototype
- [x] **Phase 3** – public walkthrough at prototype fidelity, `/catalog`, `/piece/[accession]`
- [ ] **Phase 4** – admin area and authentication
- [ ] **Phase 5** – AI intake, valuation research, CSV export
