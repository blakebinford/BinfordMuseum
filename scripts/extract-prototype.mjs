/**
 * One-time extraction of the approved design prototype.
 *
 * Parses docs/gulf-coast-collection.html (the source of record) and produces:
 *   - seed/images/*.jpg            decoded originals (23 fronts + 2 backs)
 *   - seed/collection.json         rooms, pieces, entry/exit copy, image facts
 *   - netlify/database/migrations/20260715150000_seed_collection/migration.sql
 *     the DML seed applied by Netlify's platform migration system on the
 *     production database and on every deploy-preview database branch
 *
 * The script is deterministic: re-running it reproduces identical output, so
 * the committed migration never drifts from the prototype.
 *
 * Titles, meta lines, and labels are extracted verbatim. The maker / medium /
 * dimensions split of each meta line cannot be derived mechanically (the
 * segments mean different things per piece), so that split is curated below,
 * keyed by accession, and cross-checked against the extracted pieces.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'docs/gulf-coast-collection.html'), 'utf8');

// Curated catalog split per accession: object type, maker/medium/dimensions
// where the meta line's structure allows, and the sortable year.
const CATALOG = {
  'GCC.1841.01': { objectType: 'currency', year: 1841, maker: 'Republic of Texas Treasury, Austin', medium: null, dimensions: null },
  'GCC.1848.01': { objectType: 'map', year: 1848, maker: 'Jeremiah Greenleaf', medium: 'Hand-colored engraving', dimensions: null },
  'GCC.1851.01': { objectType: 'map', year: 1851, maker: 'John Tallis & Co., London', medium: 'Steel engraving by John Rapkin, with vignettes', dimensions: null },
  'GCC.1861.01': { objectType: 'document', year: 1861, maker: null, medium: 'Period newspaper printing', dimensions: null },
  'GCC.1862.01': { objectType: 'currency', year: 1862, maker: 'State of Texas', medium: 'Military payment issue', dimensions: null },
  'GCC.1862.02': { objectType: 'currency', year: 1862, maker: 'State of Texas, Austin', medium: null, dimensions: null },
  'GCC.1865.01': { objectType: 'map', year: 1865, maker: 'S. Augustus Mitchell, Philadelphia', medium: 'Hand-colored engraving', dimensions: null },
  'GCC.1880.01': { objectType: 'map', year: 1880, maker: 'United States Census cartography', medium: 'Lithograph', dimensions: null },
  'GCC.1889.01': { objectType: 'map', year: 1889, maker: 'U.S. Army Corps of Engineers', medium: null, dimensions: null },
  'GCC.1896.01': { objectType: 'print', year: 1896, maker: 'Munn & Co., New York', medium: 'Journal cover', dimensions: null },
  'GCC.1900.01': { objectType: 'stereoview', year: 1900, maker: null, medium: 'Stereoview', dimensions: null },
  'GCC.1900.02': { objectType: 'stereoview', year: 1900, maker: null, medium: 'Stereoview', dimensions: null },
  'GCC.1900.03': { objectType: 'stereoview', year: 1900, maker: 'Keystone View Co., Meadville, Pennsylvania', medium: null, dimensions: null },
  'GCC.1900.04': { objectType: 'print', year: 1900, maker: 'Black and White, London', medium: 'Halftone press page', dimensions: null },
  'GCC.1904.01': { objectType: 'print', year: 1904, maker: null, medium: 'Print article', dimensions: null },
  'GCC.1915.01': { objectType: 'photograph', year: 1915, maker: null, medium: 'Real photo postcard', dimensions: null },
  'GCC.1901.01': { objectType: 'stereoview', year: 1901, maker: 'Keystone View Co., Beaumont', medium: null, dimensions: null },
  'GCC.1901.02': { objectType: 'stereoview', year: 1901, maker: null, medium: 'Stereoview', dimensions: null },
  'GCC.1902.01': { objectType: 'certificate', year: 1902, maker: null, medium: null, dimensions: null },
  'GCC.1910.01': { objectType: 'certificate', year: 1910, maker: null, medium: 'Signed certificate', dimensions: null },
  'GCC.1909.01': { objectType: 'object', year: 1909, maker: null, medium: 'Iron', dimensions: null },
  'GCC.1905.01': { objectType: 'map', year: 1905, maker: null, medium: 'Lithograph', dimensions: '21.5 x 13.5 in.' },
  'GCC.1930.01': { objectType: 'object', year: 1930, maker: null, medium: 'Painted steel', dimensions: null },
};

function fail(msg) {
  console.error(`extract-prototype: ${msg}`);
  process.exit(1);
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function text(re, src, what) {
  const m = src.match(re);
  if (!m) fail(`could not extract ${what}`);
  return decodeEntities(m[1]);
}

// JPEG dimensions from the SOF0/1/2 marker.
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) fail('not a JPEG');
  let off = 2;
  while (off < buf.length - 9) {
    if (buf[off] !== 0xff) fail('bad JPEG marker structure');
    const marker = buf[off + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  fail('no SOF marker found');
}

// ---------------------------------------------------------------- entry/exit
const entrySection = html.match(/<section class="entry"[\s\S]*?<\/section>/)?.[0] ?? fail('entry section');
const entry = {
  eyebrow: text(/class="eyebrow r in">([\s\S]*?)<\/p>/, entrySection, 'entry eyebrow'),
  title: text(/<h1 class="r in">([\s\S]*?)<\/h1>/, entrySection, 'entry title'),
  sub: text(/class="sub r in">([\s\S]*?)<\/p>/, entrySection, 'entry sub'),
  wallText: text(/class="walltext r in">([\s\S]*?)<\/p>/, entrySection, 'entry wall text'),
  cue: text(/class="cue">([\s\S]*?)<\/div>/, entrySection, 'entry cue'),
};

const exitSection = html.match(/<section class="exit"[\s\S]*?<\/section>/)?.[0] ?? fail('exit section');
const exitParagraphs = [...exitSection.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => decodeEntities(m[1]));
if (exitParagraphs.length !== 2) fail(`expected 2 exit paragraphs, got ${exitParagraphs.length}`);
const exit = {
  title: text(/<h2>([\s\S]*?)<\/h2>/, exitSection, 'exit title'),
  paragraphs: exitParagraphs,
  colophon: text(/class="colophon">([\s\S]*?)<\/p>/, exitSection, 'exit colophon'),
};

// ------------------------------------------------- addendum copy overrides
// The AI-features addendum supersedes the verbatim extraction for these
// entry and exit strings so the homepage stays accurate as the collection
// grows: no object counts, room counts, or date ranges to maintain. The
// exhibition title, eyebrow, cue, exit title, and second exit paragraph
// remain verbatim from the prototype. Room and piece extraction (and the
// seed migration built from it) are untouched.
entry.sub = 'The history of Texas in maps, money, photographs, and objects';
entry.wallText =
  'Every object in these rooms witnessed Texas history firsthand: the republic on paper, the engineered coast, the storm and the answer to it, the age of oil. Assembled piece by piece and cataloged in a private archive, the collection grows as new pieces are acquired and earn their place in the rooms. Select any piece to view its full label.';
exit.paragraphs[0] =
  "These rooms draw from a private collection of Texana: original maps, documents, currency, photographs, and objects gathered for what they witnessed of the state's history.";
exit.colophon = 'The Binford Collection · MMXXVI';

// --------------------------------------------------------------------- backs
const backsSrc = html.match(/const BACKS = (\{[\s\S]*?\});/)?.[1] ?? fail('BACKS map');
const backs = JSON.parse(backsSrc);
const backKeys = Object.keys(backs);
if (backKeys.length !== 2 || !backKeys.includes('nav') || !backKeys.includes('tw')) {
  fail(`unexpected BACKS keys: ${backKeys}`);
}

// --------------------------------------------------------------------- rooms
const roomSections = [...html.matchAll(/<section class="room( storm)?" id="room-(\d)" data-room="(\d)" data-label="([^"]*)">([\s\S]*?)<\/section>/g)];
if (roomSections.length !== 6) fail(`expected 6 rooms, got ${roomSections.length}`);

const rooms = [];
const pieces = [];
let pieceId = 0;

for (const [, storm, roomNum, dataRoom, dataLabel, body] of roomSections) {
  const roomId = Number(roomNum);
  const room = {
    id: roomId,
    numeral: text(/<span class="num">Room ([\s\S]*?)<\/span>/, body, `room ${roomId} numeral`),
    title: text(/<h2>([\s\S]*?)<\/h2>/, body, `room ${roomId} title`),
    dateRange: text(/<span class="dates">([\s\S]*?)<\/span>/, body, `room ${roomId} dates`),
    wallText: text(/class="walltext">([\s\S]*?)<\/p>/, body, `room ${roomId} wall text`),
    sort: roomId,
    storm: storm !== undefined,
    dataLabel: decodeEntities(dataLabel),
  };
  rooms.push(room);

  const figures = [...body.matchAll(/<figure class="piece ([^"]*)">([\s\S]*?)<\/figure>/g)];
  let order = 0;
  for (const [, classes, fig] of figures) {
    pieceId += 1;
    order += 1;
    const key = text(/data-key="([^"]+)"/, fig, `piece ${pieceId} key`);
    const hasBack = /data-back="1"/.test(fig);
    const accession = text(/<span class="acc">([\s\S]*?)<\/span>/, fig, `piece ${key} accession`);
    const front = fig.match(/src="data:image\/jpeg;base64,([^"]+)"/)?.[1] ?? fail(`piece ${key} front image`);
    pieces.push({
      id: pieceId,
      key,
      accession,
      title: text(/<h3>([\s\S]*?)<\/h3>/, fig, `piece ${key} title`),
      meta: text(/<p class="meta">([\s\S]*?)<\/p>/, fig, `piece ${key} meta`),
      label: text(/<p class="note">([\s\S]*?)<\/p>/, fig, `piece ${key} label`),
      alt: text(/alt="([^"]*)"/, fig, `piece ${key} alt`),
      roomId,
      roomOrder: order,
      layout: classes.trim(),
      hasBack,
      frontB64: front,
    });
  }
}

if (pieces.length !== 23) fail(`expected 23 pieces, got ${pieces.length}`);
const perRoom = rooms.map((r) => pieces.filter((p) => p.roomId === r.id).length);
if (perRoom.join(',') !== '3,3,4,4,2,7') fail(`unexpected room distribution: ${perRoom}`);
if (rooms.filter((r) => r.storm).length !== 1 || !rooms[3].storm) fail('storm treatment should be room IV only');

const extracted = new Set(pieces.map((p) => p.accession));
for (const acc of Object.keys(CATALOG)) if (!extracted.has(acc)) fail(`curated accession ${acc} not found in prototype`);
for (const acc of extracted) if (!CATALOG[acc]) fail(`extracted accession ${acc} missing from curated catalog`);
for (const p of pieces) {
  if (!p.label) fail(`piece ${p.accession} has an empty label`);
  if (p.hasBack && !backs[p.key]) fail(`piece ${p.accession} marked data-back but missing in BACKS`);
}

// The prototype's EXT (extended label) map must be empty: each piece has
// exactly one label and the split is not reintroduced.
const extSrc = html.match(/const EXT = (\{[\s\S]*?\});/)?.[1] ?? fail('EXT map');
const ext = JSON.parse(extSrc);
if (Object.values(ext).some((v) => v !== '')) fail('EXT map is not empty; prototype changed?');

// -------------------------------------------------------------------- images
const imagesDir = join(root, 'seed/images');
mkdirSync(imagesDir, { recursive: true });

function slug(accession) {
  return accession.toLowerCase().replace(/\./g, '-');
}

const images = [];
for (const p of pieces) {
  const sides = [{ kind: 'front', b64: p.frontB64, sort: 0 }];
  if (p.hasBack) {
    const b64 = backs[p.key].replace(/^data:image\/jpeg;base64,/, '');
    sides.push({ kind: 'back', b64, sort: 1 });
  }
  for (const side of sides) {
    const buf = Buffer.from(side.b64, 'base64');
    const { width, height } = jpegSize(buf);
    const file = `${slug(p.accession)}-${side.kind}.jpg`;
    writeFileSync(join(imagesDir, file), buf);
    images.push({
      pieceId: p.id,
      accession: p.accession,
      blobKey: `pieces/${file}`,
      file,
      kind: side.kind,
      width,
      height,
      alt: p.alt,
      sort: side.sort,
    });
  }
}
if (images.length !== 25) fail(`expected 25 images, got ${images.length}`);

// ---------------------------------------------------------- collection.json
const collection = {
  source: 'docs/gulf-coast-collection.html',
  entry,
  exit,
  rooms: rooms.map(({ storm, dataLabel, ...r }) => ({ ...r, storm, dataLabel })),
  pieces: pieces.map((p) => {
    const c = CATALOG[p.accession];
    const metaSegments = p.meta.split(' · ');
    return {
      id: p.id,
      accession: p.accession,
      title: p.title,
      maker: c.maker,
      dateDisplay: metaSegments[0],
      dateSortYear: c.year,
      medium: c.medium,
      dimensions: c.dimensions,
      objectType: c.objectType,
      meta: p.meta,
      roomId: p.roomId,
      roomOrder: p.roomOrder,
      label: p.label,
      isPublic: true,
      layout: p.layout,
      images: images
        .filter((i) => i.pieceId === p.id)
        .map(({ blobKey, kind, width, height, alt, sort }) => ({ blobKey, kind, width, height, alt, sort })),
    };
  }),
};

mkdirSync(join(root, 'seed'), { recursive: true });
writeFileSync(join(root, 'seed/collection.json'), JSON.stringify(collection, null, 2) + '\n');

// ---------------------------------------------------------- seed migration
function q(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const lines = [
  '-- Seed: the 23 pieces, 6 rooms, and 25 image records of the founding',
  '-- collection, extracted verbatim from docs/gulf-coast-collection.html by',
  '-- scripts/extract-prototype.mjs. Do not edit by hand; re-run the script.',
  '',
];

for (const r of collection.rooms) {
  lines.push(
    `INSERT INTO rooms (id, numeral, title, date_range, wall_text, sort) VALUES (${q(r.id)}, ${q(r.numeral)}, ${q(r.title)}, ${q(r.dateRange)}, ${q(r.wallText)}, ${q(r.sort)}) ON CONFLICT (numeral) DO NOTHING;`,
  );
}
lines.push('');
for (const p of collection.pieces) {
  lines.push(
    `INSERT INTO pieces (id, accession, title, maker, date_display, date_sort_year, medium, dimensions, object_type, meta, room_id, room_order, label, is_public) VALUES (${q(p.id)}, ${q(p.accession)}, ${q(p.title)}, ${q(p.maker)}, ${q(p.dateDisplay)}, ${q(p.dateSortYear)}, ${q(p.medium)}, ${q(p.dimensions)}, ${q(p.objectType)}, ${q(p.meta)}, ${q(p.roomId)}, ${q(p.roomOrder)}, ${q(p.label)}, TRUE) ON CONFLICT (accession) DO NOTHING;`,
  );
}
lines.push('');
for (const i of images) {
  lines.push(
    `INSERT INTO piece_images (piece_id, blob_key, kind, width, height, alt, sort) VALUES (${q(i.pieceId)}, ${q(i.blobKey)}, ${q(i.kind)}, ${q(i.width)}, ${q(i.height)}, ${q(i.alt)}, ${q(i.sort)}) ON CONFLICT (blob_key) DO NOTHING;`,
  );
}
lines.push('');
lines.push(`SELECT setval(pg_get_serial_sequence('rooms', 'id'), (SELECT MAX(id) FROM rooms));`);
lines.push(`SELECT setval(pg_get_serial_sequence('pieces', 'id'), (SELECT MAX(id) FROM pieces));`);
lines.push('');

const migrationDir = join(root, 'netlify/database/migrations/20260715150000_seed_collection');
mkdirSync(migrationDir, { recursive: true });
writeFileSync(join(migrationDir, 'migration.sql'), lines.join('\n'));

console.log(`Extracted ${pieces.length} pieces, ${rooms.length} rooms, ${images.length} images.`);
console.log('Wrote seed/collection.json, seed/images/, and the seed migration.');
