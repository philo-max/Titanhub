import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  doublePrecision,
  pgEnum,
  bigint,
  real,
  boolean,
  unique,
} from 'drizzle-orm/pg-core';

export const mediaTypeEnum = pgEnum('media_type', ['anime', 'manga', 'novel', 'movie']);
export const trackingStatusEnum = pgEnum('tracking_status', [
  'watching',
  'completed',
  'plan_to',
  'dropped',
]);

// Users Table
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: varchar('username', { length: 32 }).unique().notNull(),
  password: varchar('password', { length: 255 }), // bcrypt hash
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Tracking Progress Table
export const tracking = pgTable(
  'tracking',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    mediaType: mediaTypeEnum('media_type').notNull(),
    mediaId: varchar('media_id', { length: 255 }).notNull(), // pluginId + '_' + localMediaId
    pluginId: varchar('plugin_id', { length: 255 }).notNull(),
    chapterNo: integer('chapter_no').default(0).notNull(),
    chapterId: varchar('chapter_id', { length: 255 }), // current chapter identifier
    progress: doublePrecision('progress').default(0.0).notNull(), // 0.0 to 1.0
    status: trackingStatusEnum('status').default('watching').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => {
    return [
      // Unique tracking progress entry per user and media item
      {
        name: 'user_media_tracking_unique',
        columns: [table.userId, table.mediaId],
      },
    ];
  }
);

// Favorites (Bookmarks) Table
export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    mediaType: mediaTypeEnum('media_type').notNull(),
    mediaId: varchar('media_id', { length: 255 }).notNull(),
    pluginId: varchar('plugin_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => {
    return [
      {
        name: 'user_media_favorites_unique',
        columns: [table.userId, table.mediaId],
      },
    ];
  }
);

// Danmaku Comments Table
export const danmaku = pgTable('danmaku', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  mediaId: varchar('media_id', { length: 255 }).notNull(),
  pluginId: varchar('plugin_id', { length: 255 }).notNull(),
  episode: varchar('episode', { length: 64 }).notNull(), // chapterId or episode name
  timeOffset: real('time_offset').notNull(), // in seconds
  content: text('content').notNull(),
  color: varchar('color', { length: 7 }).default('#FFFFFF').notNull(),
  userHash: varchar('user_hash', { length: 32 }), // anonymous user identifier hash
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Media View Counts Table (drives real trending rankings)
export const mediaViews = pgTable(
  'media_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    mediaType: mediaTypeEnum('media_type').notNull(),
    mediaId: varchar('media_id', { length: 255 }).notNull(),
    pluginId: varchar('plugin_id', { length: 255 }).notNull(),
    title: varchar('title', { length: 512 }).notNull(),
    cover: text('cover'),
    views: integer('views').default(0).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => {
    return [
      unique('plugin_media_views_unique').on(table.pluginId, table.mediaId, table.mediaType),
    ];
  }
);

// Plugins Table
export const plugins = pgTable('plugins', {
  id: uuid('id').defaultRandom().primaryKey(),
  identifier: varchar('identifier', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  version: varchar('version', { length: 16 }),
  types: varchar('types', { length: 255 }), // e.g. "anime,manga"
  author: varchar('author', { length: 128 }),
  code: text('code').notNull(),
  isBuiltin: boolean('is_builtin').default(false).notNull(),
  installCount: integer('install_count').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
