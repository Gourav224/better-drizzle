import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

const authors = sqliteTable('count_authors', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});
const posts = sqliteTable('count_posts', {
	id: integer('id').primaryKey(),
	authorId: integer('author_id').notNull(),
});
const relations = defineRelations({ authors, posts }, (r) => ({
	authors: {
		posts: r.many.posts({ from: r.authors.id, to: r.posts.authorId }),
	},
}));

const sqlite = new Database(':memory:');
const db = better(drizzle({ client: sqlite, relations }));

beforeAll(() => {
	sqlite.exec(`
		CREATE TABLE count_authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
		CREATE TABLE count_posts (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL);
		INSERT INTO count_authors VALUES (1, 'Ana'), (2, 'Bia');
		INSERT INTO count_posts VALUES (1, 1), (2, 1), (3, 2);
	`);
});

afterAll(() => sqlite.close());

test('count in include and orderBy', async () => {
	const rows = await db.authors.findMany({
		include: { count: { select: { posts: true } } },
		orderBy: { posts: { count: 'desc' } },
	});
	expect(rows.map((row) => row.count.posts)).toEqual([2, 1]);
});

test('the deprecated _count alias keeps its result key and warns once', async () => {
	const warnings: { code?: string }[] = [];
	const listener = (warning: { code?: string }) => warnings.push(warning);
	process.on('warning', listener);
	try {
		const include = { _count: { select: { posts: true } } } as never;
		const rows = (await db.authors.findMany({
			include,
			orderBy: { posts: { _count: 'desc' } } as never,
		})) as unknown as { _count: { posts: number }; count?: unknown }[];
		await db.authors.findMany({ include });
		await new Promise((resolve) => setImmediate(resolve));
		expect(rows.map((row) => row._count.posts)).toEqual([2, 1]);
		expect(rows[0]?.count).toBeUndefined();
		expect(
			warnings.filter(
				(warning) => warning.code === 'BETTER_DRIZZLE_COUNT_DEPRECATED',
			).length,
		).toBeLessThanOrEqual(1);
	} finally {
		process.off('warning', listener);
	}
});

test('count and _count in the same include are rejected', async () => {
	const select = { select: { posts: true } };
	await expect(
		Promise.resolve(
			db.authors.findMany({
				include: { count: select, _count: select } as never,
			}),
		),
	).rejects.toMatchObject({ code: 'INVALID_ARGS' });
});
