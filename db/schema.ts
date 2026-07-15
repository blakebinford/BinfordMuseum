import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const objectTypeEnum = pgEnum('object_type', [
  'map',
  'document',
  'currency',
  'stereoview',
  'photograph',
  'print',
  'certificate',
  'object',
]);

export const imageKindEnum = pgEnum('image_kind', ['front', 'back', 'detail']);

export const valuationMethodEnum = pgEnum('valuation_method', [
  'ai_research',
  'comparable_sale',
  'appraisal',
  'owner_estimate',
]);

export const conditionGradeEnum = pgEnum('condition_grade', [
  'fine',
  'very_good',
  'good',
  'fair',
  'poor',
]);

export const noteAuthorEnum = pgEnum('note_author', ['ai', 'owner']);

export const rooms = pgTable('rooms', {
  id: serial().primaryKey(),
  numeral: text().notNull().unique(),
  title: text().notNull(),
  dateRange: text('date_range').notNull(),
  wallText: text('wall_text').notNull(),
  sort: integer().notNull(),
});

export const pieces = pgTable(
  'pieces',
  {
    id: serial().primaryKey(),
    accession: text().notNull().unique(),
    title: text().notNull(),
    maker: text(),
    dateDisplay: text('date_display'),
    dateSortYear: integer('date_sort_year'),
    medium: text(),
    dimensions: text(),
    objectType: objectTypeEnum('object_type').notNull(),
    // The original unsplit meta line from the placard, kept verbatim.
    meta: text(),
    roomId: integer('room_id').references(() => rooms.id, {
      onDelete: 'set null',
    }),
    roomOrder: integer('room_order'),
    label: text().notNull().default(''),
    isPublic: boolean('is_public').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('pieces_room_idx').on(table.roomId)],
);

export const pieceImages = pgTable(
  'piece_images',
  {
    id: serial().primaryKey(),
    pieceId: integer('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    blobKey: text('blob_key').notNull().unique(),
    kind: imageKindEnum().notNull().default('front'),
    width: integer().notNull(),
    height: integer().notNull(),
    alt: text().notNull().default(''),
    sort: integer().notNull().default(0),
  },
  (table) => [index('piece_images_piece_idx').on(table.pieceId)],
);

export const acquisitions = pgTable(
  'acquisitions',
  {
    id: serial().primaryKey(),
    pieceId: integer('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    acquiredOn: date('acquired_on'),
    source: text(),
    pricePaidCents: bigint('price_paid_cents', { mode: 'number' }),
    provenanceText: text('provenance_text'),
    isPublicProvenance: boolean('is_public_provenance').notNull().default(false),
    notes: text(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('acquisitions_piece_idx').on(table.pieceId)],
);

export const valuations = pgTable(
  'valuations',
  {
    id: serial().primaryKey(),
    pieceId: integer('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    valuedOn: date('valued_on').notNull(),
    method: valuationMethodEnum().notNull(),
    amountLowCents: bigint('amount_low_cents', { mode: 'number' }),
    amountHighCents: bigint('amount_high_cents', { mode: 'number' }),
    currency: text().notNull().default('USD'),
    // Array of { source, description, price, date, url }.
    comparables: jsonb().$type<
      Array<{
        source: string;
        description: string;
        price: string;
        date: string;
        url: string;
      }>
    >(),
    notes: text(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('valuations_piece_idx').on(table.pieceId)],
);

export const conditionReports = pgTable(
  'condition_reports',
  {
    id: serial().primaryKey(),
    pieceId: integer('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    reportedOn: date('reported_on').notNull(),
    grade: conditionGradeEnum().notNull(),
    notes: text(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('condition_reports_piece_idx').on(table.pieceId)],
);

export const researchNotes = pgTable(
  'research_notes',
  {
    id: serial().primaryKey(),
    pieceId: integer('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    // Array of { title, url } source references.
    sources: jsonb().$type<Array<{ title: string; url: string }>>(),
    createdBy: noteAuthorEnum('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('research_notes_piece_idx').on(table.pieceId)],
);

export type Room = typeof rooms.$inferSelect;
export type Piece = typeof pieces.$inferSelect;
export type NewPiece = typeof pieces.$inferInsert;
export type PieceImage = typeof pieceImages.$inferSelect;
export type Acquisition = typeof acquisitions.$inferSelect;
export type Valuation = typeof valuations.$inferSelect;
export type ConditionReport = typeof conditionReports.$inferSelect;
export type ResearchNote = typeof researchNotes.$inferSelect;
