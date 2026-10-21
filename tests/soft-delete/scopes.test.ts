import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { softDelete } from '../../src/plugins/soft-delete';
import { tenant } from '../../src/plugins/tenant';

const posts = sqliteTable('sd_posts', {
	deletedAt: integer('deleted_at', { mode: 'timestamp' }),
	id: integer('id').primaryKey(),
	organizationId: text('organization_id').notNull(),
	title: text('title').notNull(),
});

const comments = sqliteTable('sd_comments', {
	body: text('body').notNull(),
	deletedAt: integer('deleted_at', { mode: 'timestamp' }),
	id: integer('id').primaryKey(),
	organizationId: text('organization_id').notNull(),
	postId: integer('post_id').notNull(),
});

const relations = defineRelations({ comments, posts }, (r) => ({
	comments: {
		post: r.one.posts({ from: r.comments.postId, to: r.posts.id }),
	},
	posts: {
		comments: r.many.comments({ from: r.posts.id, to: r.comments.postId }),
	},
}));

// Post 2 is deleted; post 1 has one live and two deleted comments; post 3
// (org b) has two live comments; comment 4 is live under the deleted post.
const createDb = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE sd_posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, organization_id TEXT NOT NULL, deleted_at INTEGER);
		CREATE TABLE sd_comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, body TEXT NOT NULL, organization_id TEXT NOT NULL, deleted_at INTEGER);
		INSERT INTO sd_posts VALUES (1, 'a-live', 'a', NULL), (2, 'a-deleted', 'a', 1710000000), (3, 'b-live', 'b', NULL);
		INSERT INTO sd_comments VALUES
			(1, 1, 'live', 'a', NULL),
			(2, 1, 'gone', 'a', 1710000000),
			(3, 1, 'gone', 'a', 1710000000),
			(4, 2, 'live', 'a', NULL),
			(5, 3, 'live', 'b', NULL),
			(6, 3, 'live', 'b', NULL);
	`);
	const raw = drizzle({ client: sqlite, relations });
	return {
		db: better(raw, { plugins: [softDelete()] }),
		raw,
		sqlite,
		tenantDb: better(raw, {
			plugins: [tenant({ columns: 'organizationId' }), softDelete()],
		}),
	};
};

const ids = (rows: readonly { id: unknown }[]) =>
	rows.map((row) => Number(row.id));

const deletedIds = (sqlite: Database, table: string) =>
	ids(
		sqlite
			.query(
				`SELECT id FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY id`,
			)
			.all() as { id: number }[],
	);

describe('soft-delete on model scopes', () => {
	test('SD-02: include and relation select hide deleted rows at every depth', async () => {
		const { db } = createDb();

		const live = await db.posts.findMany({
			include: { comments: { orderBy: { id: 'asc' } } },
			orderBy: { id: 'asc' },
		});
		expect(live.map((row) => [row.id, ids(row.comments)])).toEqual([
			[1, [1]],
			[3, [5, 6]],
		]);

		// `deleted` controls the root only (D28).
		const all = await db.posts.findMany({
			deleted: 'with',
			orderBy: { id: 'asc' },
			select: {
				comments: { orderBy: { id: 'asc' }, select: { id: true } },
				id: true,
			},
		});
		expect(all.map((row) => [row.id, ids(row.comments)])).toEqual([
			[1, [1]],
			[2, [4]],
			[3, [5, 6]],
		]);

		const withPost = await db.comments.findMany({
			include: { post: true },
			orderBy: { id: 'asc' },
		});
		expect(withPost.map((row) => [row.id, row.post?.id ?? null])).toEqual([
			[1, 1],
			[4, null],
			[5, 3],
			[6, 3],
		]);
	});

	test('SD-02: count and relation sorts ignore deleted rows', async () => {
		const { db } = createDb();

		const counted = await db.posts.findMany({
			include: { count: { select: { comments: true } } },
			orderBy: { id: 'asc' },
		});
		expect(counted.map((row) => row.count)).toEqual([
			{ comments: 1 },
			{ comments: 2 },
		]);

		expect(
			ids(
				await db.posts.findMany({
					orderBy: [{ comments: { count: 'desc' } }, { id: 'asc' }],
				}),
			),
		).toEqual([3, 1]);
		expect(
			ids(
				await db.comments.findMany({
					orderBy: [
						{
							post: {
								title: { direction: 'asc', nulls: 'first' },
							},
						},
						{ id: 'asc' },
					],
				}),
			),
		).toEqual([4, 1, 5, 6]);
	});

	test('SD-02: relation filters ignore deleted rows', async () => {
		const { db } = createDb();
		const postIds = async (where: object) =>
			ids(
				await db.posts.findMany({
					orderBy: { id: 'asc' },
					where: where as never,
				}),
			);

		expect(await postIds({ comments: { some: { id: 2 } } })).toEqual([]);
		expect(await postIds({ comments: { none: { body: 'gone' } } })).toEqual(
			[1, 3],
		);
		expect(
			await postIds({ comments: { every: { body: 'live' } } }),
		).toEqual([1, 3]);
		expect(
			ids(
				await db.comments.findMany({
					orderBy: { id: 'asc' },
					where: { post: { is: null } },
				}),
			),
		).toEqual([4]);
	});

	test('relation writes cannot connect deleted rows', async () => {
		const { db } = createDb();

		await expect(
			db.comments.update({
				data: { post: { connect: { id: 2 } } },
				where: { id: 1 },
			}),
		).rejects.toThrow('Relation selector did not match a record.');
		expect(
			await db.comments.update({
				data: { post: { connect: { id: 3 } } },
				where: { id: 1 },
			}),
		).toMatchObject({ postId: 3 });
	});

	test('SD-01: root visibility still follows `deleted`', async () => {
		const { db } = createDb();

		expect(
			ids(await db.posts.findMany({ orderBy: { id: 'asc' } })),
		).toEqual([1, 3]);
		expect(
			ids(
				await db.posts.findMany({
					deleted: 'only',
					orderBy: { id: 'asc' },
				}),
			),
		).toEqual([2]);
		expect(await db.posts.count({ deleted: 'with' })).toBe(3);
	});

	test('SD-01: paginate totals follow `deleted`', async () => {
		const { db } = createDb();
		const page = async (deleted?: 'with' | 'only' | 'without') => {
			const {
				data,
				pagination: { pageCount, total },
			} = await db.posts.paginate({
				deleted,
				orderBy: { id: 'asc' },
				perPage: 2,
			});
			return { ids: ids(data), pageCount, total };
		};

		expect(await page()).toEqual({ ids: [1, 3], pageCount: 1, total: 2 });
		expect(await page('without')).toEqual({
			ids: [1, 3],
			pageCount: 1,
			total: 2,
		});
		expect(await page('with')).toEqual({
			ids: [1, 2],
			pageCount: 2,
			total: 3,
		});
		expect(await page('only')).toEqual({
			ids: [2],
			pageCount: 1,
			total: 1,
		});
	});

	test('SD-05: $withoutPlugins() reads deleted rows, nested ones included', async () => {
		const { db } = createDb();

		const rows = await db.posts.$withoutPlugins().findMany({
			include: { comments: { orderBy: { id: 'asc' } } },
			orderBy: { id: 'asc' },
		});
		expect(rows.map((row) => [row.id, ids(row.comments)])).toEqual([
			[1, [1, 2, 3]],
			[2, [4]],
			[3, [5, 6]],
		]);
	});

	test('SCOPE-10: $where() includes the soft-delete filter and the tenant scope', async () => {
		const { db, raw, tenantDb } = createDb();
		const a = tenantDb.$tenant({ organizationId: 'a' });
		const select = (where: ReturnType<typeof db.posts.$where>) =>
			raw.select({ id: posts.id }).from(posts).where(where);

		expect(select(db.posts.$where()).toSQL()).toEqual({
			params: [],
			sql: 'select "id" from "sd_posts" where ("sd_posts"."deleted_at" is null)',
		});
		expect(ids(await select(db.posts.$where()))).toEqual([1, 3]);

		const scoped = select(a.posts.$where({ id: { in: [1, 2, 3] } }));
		expect(scoped.toSQL()).toEqual({
			params: [1, 2, 3, 'a'],
			sql: 'select "id" from "sd_posts" where (("sd_posts"."id" in (?, ?, ?)) and ((("sd_posts"."organization_id" = ?) and (("sd_posts"."deleted_at" is null)))))',
		});
		expect(ids(await scoped)).toEqual([1]);
	});

	test('SD-03: soft deletes keep the tenant scope', async () => {
		const { sqlite, tenantDb } = createDb();
		const a = tenantDb.$tenant({ organizationId: 'a' });

		expect(
			await a.posts.deleteMany({ where: { id: { in: [1, 3] } } }),
		).toMatchObject({ count: 1 });
		expect(
			await a.comments.delete({
				where: { postId: { in: [3, 2] } },
			}),
		).toMatchObject({ id: 4 });
		expect(deletedIds(sqlite, 'sd_posts')).toEqual([1, 2]);
		expect(deletedIds(sqlite, 'sd_comments')).toEqual([2, 3, 4]);
	});

	test('restore and restoreById keep the tenant scope', async () => {
		const { sqlite, tenantDb } = createDb();
		const a = tenantDb.$tenant({ organizationId: 'a' });
		const b = tenantDb.$tenant({ organizationId: 'b' });

		expect(await b.posts.restoreById(2)).toBeNull();
		expect(await b.comments.restore({ where: { id: 2 } })).toBeNull();
		expect(deletedIds(sqlite, 'sd_posts')).toEqual([2]);

		expect(await a.posts.restoreById(2)).toMatchObject({
			deletedAt: null,
			id: 2,
		});
		expect(await a.comments.restore({ where: { id: 2 } })).toMatchObject({
			id: 2,
		});
		expect(deletedIds(sqlite, 'sd_posts')).toEqual([]);
		expect(deletedIds(sqlite, 'sd_comments')).toEqual([3]);
	});

	test('a default hard mode purges deleted rows', async () => {
		const { sqlite } = createDb();
		const db = better(drizzle({ client: sqlite, relations }), {
			plugins: [softDelete({ defaults: { mode: 'hard' } })],
		});

		expect(await db.posts.delete({ where: { id: 2 } })).toMatchObject({
			id: 2,
		});
		expect(
			await db.posts.deleteMany({ deleted: 'only', where: { id: 1 } }),
		).toMatchObject({ count: 0 });
		expect(
			ids(
				sqlite
					.query('SELECT id FROM sd_posts ORDER BY id')
					.all() as never,
			),
		).toEqual([1, 3]);
	});

	test('upserts still reach deleted rows instead of inserting duplicates', async () => {
		const { db, sqlite } = createDb();

		await db.posts.upsert({
			create: { id: 2, organizationId: 'a', title: 'new' },
			update: { title: 'native' },
			where: { id: 2 },
		});
		await db.comments.upsert({
			create: { body: 'new', id: 9, organizationId: 'a', postId: 1 },
			update: { body: 'fallback' },
			where: { body: 'gone', id: 3 },
		});
		await db.posts.upsertMany({
			data: [{ id: 2, organizationId: 'a', title: 'batch' }],
			target: 'id',
			update: ['title'],
		});

		expect(
			sqlite.query('SELECT id, title FROM sd_posts ORDER BY id').all(),
		).toEqual([
			{ id: 1, title: 'a-live' },
			{ id: 2, title: 'batch' },
			{ id: 3, title: 'b-live' },
		]);
		expect(
			sqlite
				.query('SELECT body FROM sd_comments WHERE id IN (3, 9)')
				.all(),
		).toEqual([{ body: 'fallback' }]);
	});
});
