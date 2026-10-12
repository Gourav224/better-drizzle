import { Database } from 'bun:sqlite';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better, definePlugin } from '../../src';

const users = sqliteTable('scope_users', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	region: text('region').notNull(),
});

const profiles = sqliteTable('scope_profiles', {
	id: integer('id').primaryKey(),
	userId: integer('user_id').notNull(),
	bio: text('bio').notNull(),
	region: text('region').notNull(),
});

const posts = sqliteTable('scope_posts', {
	id: integer('id').primaryKey(),
	authorId: integer('author_id').notNull(),
	title: text('title').notNull(),
	region: text('region').notNull(),
});

const tags = sqliteTable('scope_tags', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	region: text('region').notNull(),
});

const postTags = sqliteTable('scope_post_tags', {
	postId: integer('post_id').notNull(),
	tagId: integer('tag_id').notNull(),
	region: text('region').notNull(),
});

const categories = sqliteTable('scope_categories', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	parentId: integer('parent_id'),
	region: text('region').notNull(),
});

const notes = sqliteTable('scope_notes', {
	id: integer('id').primaryKey(),
	body: text('body').notNull(),
});

const schema = { categories, notes, posts, postTags, profiles, tags, users };

const relations = defineRelations(schema, (r) => ({
	categories: {
		children: r.many.categories(),
		parent: r.one.categories({
			from: r.categories.parentId,
			to: r.categories.id,
		}),
	},
	posts: {
		author: r.one.users({ from: r.posts.authorId, to: r.users.id }),
		tags: r.many.tags({
			from: r.posts.id.through(r.postTags.postId),
			to: r.tags.id.through(r.postTags.tagId),
		}),
	},
	tags: {
		posts: r.many.posts({
			from: r.tags.id.through(r.postTags.tagId),
			to: r.posts.id.through(r.postTags.postId),
		}),
	},
	users: {
		posts: r.many.posts({ from: r.users.id, to: r.posts.authorId }),
		profile: r.one.profiles({ from: r.users.id, to: r.profiles.userId }),
	},
}));

export type ScopeEvent = {
	hook: string;
	inTransaction?: boolean;
	scopes: unknown;
};

/**
 * Test plugin with a `region` scope on every table that has a `region`
 * column. `$inRegion(region)` scopes a client, `$anyRegion()` sets a `null`
 * state (bypass), and `$region` exposes the active state.
 */
export const regionPlugin = (events: ScopeEvent[] = []) =>
	definePlugin({
		extendClient: ({ scope, withScope }) => ({
			$anyRegion: () => withScope(null, { regionBypass: 'any' }),
			$inRegion: (region: string) => withScope({ region }),
			$region: scope,
		}),
		hooks: {
			beforeCreate(ctx) {
				events.push({
					hook: 'beforeCreate',
					inTransaction: ctx.isInTransaction,
					scopes: ctx.scopes,
				});
				return ctx.data;
			},
			beforeQuery(ctx) {
				events.push({ hook: 'beforeQuery', scopes: ctx.scopes });
			},
		},
		id: 'test/region',
		intercept(ctx) {
			events.push({ hook: 'intercept', scopes: ctx.scopes });
			return ctx.next();
		},
		scope: {
			bypass: (state) =>
				state === null
					? undefined
					: { regionBypass: '$withoutPlugins' },
			key: 'region',
			mismatch: (model, column) =>
				new Error(`REGION_MISMATCH ${model.name}.${column}`),
			missing: (model) => new Error(`REGION_REQUIRED ${model.name}`),
			model: (model) =>
				model.hasColumn('region')
					? { columns: ['region'], immutable: true, stamp: true }
					: undefined,
		},
		transform(input) {
			events.push({ hook: 'transform', scopes: input.scopes });
			return input;
		},
	});

export type MetaHooks = Record<string, (context: { meta?: unknown }) => void>;

export const createScopeDb = (
	options: { events?: ScopeEvent[]; hooks?: MetaHooks; plain?: boolean } = {},
) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
CREATE TABLE scope_users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL);
CREATE TABLE scope_profiles (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, bio TEXT NOT NULL, region TEXT NOT NULL);
CREATE TABLE scope_posts (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, title TEXT NOT NULL, region TEXT NOT NULL);
CREATE TABLE scope_tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL);
CREATE TABLE scope_post_tags (post_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, region TEXT NOT NULL);
CREATE TABLE scope_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER, region TEXT NOT NULL);
CREATE TABLE scope_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
INSERT INTO scope_users VALUES (1, 'Ann', 'eu'), (2, 'Bob', 'us'), (3, 'Cid', 'eu');
INSERT INTO scope_profiles VALUES (1, 1, 'ann', 'eu'), (2, 2, 'bob', 'us'), (3, 3, 'cid', 'us');
INSERT INTO scope_posts VALUES (1, 1, 'eu-1', 'eu'), (2, 2, 'us-1', 'us'), (3, 3, 'eu-2', 'eu'), (4, 1, 'us-2', 'us'), (5, 2, 'eu-3', 'eu');
INSERT INTO scope_tags VALUES (1, 'eu-tag', 'eu'), (2, 'us-tag', 'us');
INSERT INTO scope_post_tags VALUES (1, 1, 'eu'), (1, 2, 'eu'), (2, 2, 'us'), (3, 1, 'us'), (3, 2, 'us');
INSERT INTO scope_categories VALUES (1, 'eu-root', NULL, 'eu'), (2, 'eu-child', 1, 'eu'), (3, 'us-child', 1, 'us'), (4, 'us-root', NULL, 'us');
INSERT INTO scope_notes VALUES (1, 'n1'), (2, 'n2');
`);
	const raw = drizzle({ client: sqlite, relations });
	const db = better(raw, {
		hooks: options.hooks as never,
		plugins: [
			options.plain
				? {
						...regionPlugin(),
						hooks: undefined,
						intercept: undefined,
						transform: undefined,
					}
				: regionPlugin(options.events),
		],
	});
	return {
		db,
		eu: db.$inRegion('eu'),
		raw,
		sqlite,
		us: db.$inRegion('us'),
	};
};
