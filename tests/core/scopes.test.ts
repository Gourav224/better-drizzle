import type { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';

import { param } from '../../src';
import { createRuntimeContext } from '../../src/shared/client/context';
import { buildJoinedOneRelationQuery } from '../../src/shared/client/operations';
import { initializePlugins } from '../../src/shared/client/plugins';
import { withScope } from '../../src/shared/client/scopes';
import { type ScopeEvent, createScopeDb, regionPlugin } from './scopes.fixture';

let sqlite: Database | undefined;

const setup = (options?: Parameters<typeof createScopeDb>[0]) => {
	const created = createScopeDb(options);
	sqlite = created.sqlite;
	return created;
};

afterEach(() => {
	sqlite?.close();
	sqlite = undefined;
});

const EU = { region: 'eu' };
const EU_SCOPES = { region: EU };

describe('model scope propagation', () => {
	test('scoped clients carry the state; the original client stays unscoped', () => {
		const { db, eu } = setup();

		expect(db.$region).toBeUndefined();
		expect(eu.$region).toEqual(EU);
		expect(eu.$inRegion('us').$region).toEqual({ region: 'us' });
		expect(eu.$region).toEqual(EU);
	});

	test('$withContext keeps the scope', () => {
		const { eu } = setup();

		expect(eu.$withContext({ requestId: 'r1' }).$region).toEqual(EU);
	});

	test('transactions and nested savepoints keep the scope', async () => {
		const events: ScopeEvent[] = [];
		const { eu } = setup({ events });

		const seen = await eu.transaction(async (tx) => {
			await tx.users.findMany();
			const nested = await tx.transaction(async (inner) => {
				await inner.users.findMany();
				return inner.$region;
			});
			return [tx.$region, nested];
		});

		expect(seen).toEqual([EU, EU]);
		expect(events.filter((event) => event.hook === 'beforeQuery')).toEqual([
			{ hook: 'beforeQuery', scopes: EU_SCOPES },
			{ hook: 'beforeQuery', scopes: EU_SCOPES },
		]);
	});

	test('implicit relation-write transactions keep the scope', async () => {
		const events: ScopeEvent[] = [];
		const { eu } = setup({ events });

		await eu.posts.create({
			data: {
				author: { connect: { id: 1 } },
				id: 10,
				region: 'eu',
				title: 'connected',
			},
		});

		expect(events.filter((event) => event.hook === 'beforeCreate')).toEqual(
			[{ hook: 'beforeCreate', inTransaction: true, scopes: EU_SCOPES }],
		);
	});

	test('extends() survives derived clients and keeps the scope', () => {
		const { eu } = setup();
		const extended = eu.extends({ tag: 'extended' });
		const derived = extended.$withContext({ requestId: 'r1' });

		expect(derived.tag).toBe('extended');
		expect(derived.$region).toEqual(EU);
	});

	test('plugin hooks, transforms, and intercepts see ctx.scopes', async () => {
		const events: ScopeEvent[] = [];
		const { db, eu } = setup({ events });

		await eu.users.findMany();
		await db.notes.findMany();

		expect(events).toEqual([
			{ hook: 'beforeQuery', scopes: EU_SCOPES },
			{ hook: 'transform', scopes: EU_SCOPES },
			{ hook: 'intercept', scopes: EU_SCOPES },
			{ hook: 'beforeQuery', scopes: {} },
			{ hook: 'transform', scopes: {} },
			{ hook: 'intercept', scopes: {} },
		]);
	});

	test('$withoutPlugins() drops the scope and reports bypass meta', async () => {
		const metas: unknown[] = [];
		const { db, eu } = setup({
			hooks: { beforeQuery: (context) => void metas.push(context.meta) },
		});

		await eu.users.$withoutPlugins().findMany();
		await eu.users.$withoutPlugins({ keepScopes: true }).findMany();
		await db.users.$withoutPlugins().findMany();

		expect(metas).toEqual([
			{ regionBypass: '$withoutPlugins' },
			undefined,
			undefined,
		]);
	});

	test('$withoutPlugins() relation writes keep dropping the scope', async () => {
		const metas: unknown[] = [];
		const events: ScopeEvent[] = [];
		const { eu } = setup({
			events,
			hooks: { beforeCreate: (context) => void metas.push(context.meta) },
		});

		await eu.posts.$withoutPlugins().create({
			data: {
				author: { connect: { id: 2 } },
				id: 11,
				region: 'us',
				title: 'bypassed',
			},
		});

		expect(metas).toEqual([{ regionBypass: '$withoutPlugins' }]);
		expect(events).toEqual([]);
	});
});

const ids = (rows: readonly { id: unknown }[]) => rows.map((row) => row.id);

describe('model scopes on root reads', () => {
	test('findMany returns only in-scope rows', async () => {
		const { eu, us } = setup();

		expect(
			ids(await eu.posts.findMany({ orderBy: { id: 'asc' } })),
		).toEqual([1, 3, 5]);
		expect(
			ids(await us.posts.findMany({ orderBy: { id: 'asc' } })),
		).toEqual([2, 4]);
		expect(
			ids(await eu.posts.findMany({ where: { authorId: 1 } })),
		).toEqual([1]);
	});

	test('findFirst, findOne, and findUnique ignore out-of-scope rows', async () => {
		const { eu } = setup();

		expect(await eu.posts.findFirst({ where: { id: 2 } })).toBeNull();
		expect(
			(await eu.posts.findFirst({ orderBy: { id: 'desc' } }))?.id,
		).toBe(5);
		expect(await eu.posts.findOne({ where: { id: 4 } })).toBeNull();
		expect((await eu.posts.findOne({ where: { id: 3 } }))?.id).toBe(3);
		expect(await eu.posts.findUnique({ where: { id: 2 } })).toBeNull();
		expect((await eu.posts.findUnique({ where: { id: 1 } }))?.title).toBe(
			'eu-1',
		);
	});

	test('count and exists only see in-scope rows', async () => {
		const { eu, us } = setup();

		expect(await eu.posts.count()).toBe(3);
		expect(await us.posts.count()).toBe(2);
		expect(await eu.posts.count({ where: { authorId: 1 } })).toBe(1);
		expect(await eu.posts.exists({ where: { id: 2 } })).toBe(false);
		expect(await eu.posts.exists({ where: { id: 1 } })).toBe(true);
	});

	test('paginate scopes data and total', async () => {
		const { eu } = setup();

		const {
			data,
			pagination: { hasNext, pageCount, total },
		} = await eu.posts.paginate({
			orderBy: { id: 'asc' },
			page: 1,
			perPage: 2,
		});

		expect(ids(data)).toEqual([1, 3]);
		expect(total).toBe(3);
		expect(pageCount).toBe(2);
		expect(hasNext).toBe(true);
	});

	test('cursor pages and navigation flags only see in-scope rows', async () => {
		const { eu, us } = setup();

		const forward = await us.posts.cursor({
			after: { id: 1 },
			limit: 1,
			orderBy: { id: 'asc' },
		});
		expect(ids(forward.data)).toEqual([2]);
		expect(forward.pagination.hasPrevious).toBe(false);
		expect(forward.pagination.hasNext).toBe(true);

		const last = await us.posts.cursor({
			after: { id: 2 },
			limit: 1,
			orderBy: { id: 'asc' },
		});
		expect(ids(last.data)).toEqual([4]);
		expect(last.pagination.hasNext).toBe(false);
		expect(last.pagination.hasPrevious).toBe(true);

		const backward = await us.posts.cursor({
			before: { id: 5 },
			limit: 5,
			orderBy: { id: 'asc' },
		});
		expect(ids(backward.data)).toEqual([2, 4]);
		expect(backward.pagination.hasNext).toBe(false);

		const filtered = await eu.posts.cursor({
			after: { id: 3 },
			limit: 1,
			orderBy: { id: 'asc' },
			where: { authorId: 2 },
		});
		expect(ids(filtered.data)).toEqual([5]);
		expect(filtered.pagination.hasPrevious).toBe(false);
	});

	test('the joined one-relation path scopes both tables', async () => {
		// Only `lock` reads reach this path, and SQLite rejects locks, so the
		// builder runs directly against a scoped runtime context.
		const { raw } = setup();
		const context = createRuntimeContext(raw, {
			plugins: [regionPlugin()],
		});
		initializePlugins(context);
		const read = (region: string, name: string) =>
			buildJoinedOneRelationQuery(
				withScope(context, 'region', { region }),
				'posts',
				{
					include: { author: true },
					orderBy: { id: 'asc' },
					where: { author: { is: { name } } },
				},
			) as unknown as Promise<{ author: { name: string }; id: number }[]>;

		expect(await read('eu', 'Bob')).toEqual([]);
		const usBob = await read('us', 'Bob');
		expect(ids(usBob)).toEqual([2]);
		expect(usBob[0]?.author.name).toBe('Bob');
		expect(ids(await read('eu', 'Ann'))).toEqual([1]);
		expect(ids(await read('us', 'Ann'))).toEqual([]);
	});

	test('$withoutPlugins() reads every row unless keepScopes is set', async () => {
		const { eu } = setup();

		expect(await eu.posts.$withoutPlugins().count()).toBe(5);
		expect(
			await eu.posts.$withoutPlugins({ keepScopes: true }).count(),
		).toBe(3);
	});

	test('a missing scope value fails before SQL; unscoped models still work', async () => {
		const { db } = setup();

		await expect(Promise.resolve(db.posts.findMany())).rejects.toThrow(
			'REGION_REQUIRED posts',
		);
		await expect(Promise.resolve(db.posts.count())).rejects.toThrow(
			'REGION_REQUIRED posts',
		);
		expect(await db.notes.count()).toBe(2);
	});
});

describe('model scopes on $where, prepared reads, and explain', () => {
	test('$where returns the predicate ANDed with the scope', async () => {
		const { eu, raw } = setup();
		const { posts } = raw._.relations;

		const scoped = await raw
			.select({ id: posts.table.id })
			.from(posts.table)
			.where(eu.posts.$where({ authorId: 1 }));
		expect(ids(scoped)).toEqual([1]);

		const scopeOnly = await raw
			.select({ id: posts.table.id })
			.from(posts.table)
			.where(eu.posts.$where())
			.orderBy(posts.table.id);
		expect(ids(scopeOnly)).toEqual([1, 3, 5]);
	});

	test('prepared reads stay scoped on every execution', async () => {
		const { eu, us } = setup({ plain: true });
		const byAuthor = eu.posts
			.findMany({
				orderBy: { id: 'asc' },
				where: { authorId: param('author') },
			})
			.prepare();
		const total = us.posts.count().prepare();

		expect(ids(await byAuthor.execute({ author: 1 }))).toEqual([1]);
		expect(ids(await byAuthor.execute({ author: 2 }))).toEqual([5]);
		expect(await total.execute({})).toBe(2);
	});

	test('.prepare() on a client without the scope value throws the definition error', () => {
		const { db } = setup({ plain: true });

		expect(() => db.posts.findMany().prepare()).toThrow(
			'REGION_REQUIRED posts',
		);
	});

	test('explain shows the scoped SQL', async () => {
		const { eu } = setup();

		const plan = await eu.posts.findMany({ where: { id: 1 } }).explain();
		const statement = plan.statements[0];

		expect(statement?.sql).toContain('`scope_posts`.`region` = ?');
		expect(statement?.params).toEqual([1, 'eu']);

		const total = await eu.posts.paginate({ perPage: 1 }).explain();
		const count = total.statements.find((entry) => entry.key === 'total');
		expect(count?.params).toEqual(['eu']);
	});
});

describe('model scopes on relation loads', () => {
	test('one relations load only in-scope targets', async () => {
		const { eu } = setup();

		const posts = await eu.posts.findMany({
			include: { author: true },
			orderBy: { id: 'asc' },
		});
		expect(posts.map((post) => post.author?.name ?? null)).toEqual([
			'Ann',
			'Cid',
			null,
		]);

		const users = await eu.users.findMany({
			include: { profile: true },
			orderBy: { id: 'asc' },
		});
		expect(users.map((user) => user.profile?.bio ?? null)).toEqual([
			'ann',
			null,
		]);
	});

	test('many relations load only in-scope targets', async () => {
		const { eu } = setup();

		const users = await eu.users.findMany({
			include: { posts: { orderBy: { id: 'asc' } } },
			orderBy: { id: 'asc' },
		});
		expect(users.map((user) => ids(user.posts))).toEqual([[1], [3]]);

		const roots = await eu.categories.findMany({
			include: { children: true },
			where: { id: 1 },
		});
		expect(ids(roots[0]?.children ?? [])).toEqual([2]);
	});

	test('many-to-many relations scope both the junction and the target', async () => {
		const { eu, us } = setup();

		const euPosts = await eu.posts.findMany({
			include: { tags: { orderBy: { id: 'asc' } } },
			orderBy: { id: 'asc' },
		});
		// Post 1: tag 2 is out of scope; post 3: its junction rows are out of scope.
		expect(euPosts.map((post) => ids(post.tags))).toEqual([[1], [], []]);

		const usPosts = await us.posts.findMany({
			include: { tags: true },
			orderBy: { id: 'asc' },
		});
		expect(usPosts.map((post) => ids(post.tags))).toEqual([[2], []]);
	});

	test('nested levels and relation select stay scoped', async () => {
		const { eu } = setup();

		const users = await eu.users.findMany({
			include: {
				posts: { include: { author: true, tags: true } },
			},
			where: { id: 1 },
		});
		expect(ids(users[0]?.posts ?? [])).toEqual([1]);
		expect(ids(users[0]?.posts[0]?.tags ?? [])).toEqual([1]);
		expect(users[0]?.posts[0]?.author?.name).toBe('Ann');

		const selected = await eu.posts.findMany({
			orderBy: { id: 'asc' },
			select: { author: { select: { name: true } }, id: true },
		});
		expect(selected).toEqual([
			{ author: { name: 'Ann' }, id: 1 },
			{ author: { name: 'Cid' }, id: 3 },
			{ author: null, id: 5 },
		]);
	});

	test('per-parent take and skip rank only in-scope rows', async () => {
		const { eu } = setup();

		const latest = await eu.users.findMany({
			include: { posts: { orderBy: { id: 'desc' }, take: 1 } },
			where: { id: 1 },
		});
		expect(ids(latest[0]?.posts ?? [])).toEqual([1]);

		const skipped = await eu.users.findMany({
			include: { posts: { orderBy: { id: 'asc' }, skip: 1, take: 1 } },
			where: { id: 1 },
		});
		expect(ids(skipped[0]?.posts ?? [])).toEqual([]);

		const tags = await eu.posts.findMany({
			include: { tags: { orderBy: { name: 'desc' }, take: 1 } },
			where: { id: 1 },
		});
		expect(tags[0]?.tags.map((tag) => tag.name)).toEqual(['eu-tag']);
	});
});

describe('model scopes on relation filters', () => {
	const sorted = { orderBy: { id: 'asc' } } as const;

	test('some and none ignore out-of-scope related rows', async () => {
		const { eu } = setup();

		expect(
			ids(
				await eu.users.findMany({
					...sorted,
					where: { posts: { some: { title: { startsWith: 'us' } } } },
				}),
			),
		).toEqual([]);
		expect(
			ids(
				await eu.users.findMany({
					...sorted,
					where: { posts: { none: { title: 'us-2' } } },
				}),
			),
		).toEqual([1, 3]);
	});

	test('every does not count out-of-scope rows as violations', async () => {
		const { eu } = setup();

		expect(
			ids(
				await eu.users.findMany({
					...sorted,
					where: {
						posts: { every: { title: { startsWith: 'eu' } } },
					},
				}),
			),
		).toEqual([1, 3]);
	});

	test('is and isNot treat out-of-scope targets as absent', async () => {
		const { eu } = setup();
		const posts = (where: Record<string, unknown>) =>
			eu.posts.findMany({ ...sorted, where: where as never });

		expect(ids(await posts({ author: { is: { name: 'Bob' } } }))).toEqual(
			[],
		);
		expect(
			ids(await posts({ author: { isNot: { name: 'Bob' } } })),
		).toEqual([1, 3, 5]);
		expect(ids(await posts({ author: { is: null } }))).toEqual([5]);
		expect(ids(await posts({ author: { isNot: null } }))).toEqual([1, 3]);
	});

	test('many-to-many filters scope the junction and the target', async () => {
		const { eu } = setup();
		const posts = (where: Record<string, unknown>) =>
			eu.posts.findMany({ ...sorted, where: where as never });

		expect(
			ids(await posts({ tags: { some: { name: 'eu-tag' } } })),
		).toEqual([1]);
		expect(
			ids(await posts({ tags: { some: { name: 'us-tag' } } })),
		).toEqual([]);
		expect(
			ids(await posts({ tags: { every: { name: 'eu-tag' } } })),
		).toEqual([1, 3, 5]);
		expect(
			ids(await posts({ tags: { none: { name: 'us-tag' } } })),
		).toEqual([1, 3, 5]);
	});

	test('self relations scope the aliased table', async () => {
		const { eu } = setup();
		const categories = (where: Record<string, unknown>) =>
			eu.categories.findMany({ ...sorted, where: where as never });

		expect(
			ids(await categories({ children: { some: { name: 'us-child' } } })),
		).toEqual([]);
		expect(ids(await categories({ children: { some: {} } }))).toEqual([1]);
		expect(
			ids(await categories({ parent: { is: { name: 'eu-root' } } })),
		).toEqual([2]);
	});
});

describe('model scopes on count and relation sorts', () => {
	test('include.count counts only in-scope rows', async () => {
		const { eu } = setup();

		const users = await eu.users.findMany({
			include: { count: { select: { posts: true } } },
			orderBy: { id: 'asc' },
		});
		expect(users.map((user) => user.count.posts)).toEqual([1, 1]);

		const filtered = await eu.users.findMany({
			include: {
				count: {
					select: {
						posts: { where: { title: { startsWith: 'us' } } },
					},
				},
			},
			orderBy: { id: 'asc' },
		});
		expect(filtered.map((user) => user.count.posts)).toEqual([0, 0]);

		const posts = await eu.posts.findMany({
			include: { count: { select: { tags: true } } },
			orderBy: { id: 'asc' },
		});
		expect(posts.map((post) => post.count.tags)).toEqual([1, 0, 0]);
	});

	test('orderBy a one-relation field reads only in-scope targets', async () => {
		const { eu } = setup();

		const posts = await eu.posts.findMany({
			orderBy: [{ author: { name: 'desc' } }, { id: 'asc' }],
		});
		expect(ids(posts)).toEqual([3, 1, 5]);
	});

	test('orderBy count counts only in-scope rows', async () => {
		const { eu } = setup();

		const users = await eu.users.findMany({
			orderBy: [{ posts: { count: 'asc' } }, { id: 'asc' }],
		});
		expect(ids(users)).toEqual([1, 3]);

		const posts = await eu.posts.findMany({
			orderBy: [{ tags: { count: 'asc' } }, { id: 'asc' }],
		});
		expect(ids(posts)).toEqual([3, 5, 1]);
	});
});

describe('model scopes on write predicates', () => {
	const titles = (sqlite: Database) =>
		sqlite.query('SELECT id, title FROM scope_posts ORDER BY id').all() as {
			id: number;
			title: string;
		}[];
	const UNCHANGED = [
		{ id: 1, title: 'eu-1' },
		{ id: 2, title: 'us-1' },
		{ id: 3, title: 'eu-2' },
		{ id: 4, title: 'us-2' },
		{ id: 5, title: 'eu-3' },
	];

	test('update never touches out-of-scope rows', async () => {
		const { eu, sqlite } = setup();

		expect(
			await eu.posts.update({ data: { title: 'x' }, where: { id: 2 } }),
		).toBeNull();
		// Not pinned: the `LIMIT 1` subquery must pick the in-scope row (5).
		const updated = await eu.posts.update({
			data: { title: 'changed' },
			where: { authorId: 2 },
		});
		expect(updated?.id).toBe(5);
		expect(titles(sqlite)).toEqual([
			{ id: 1, title: 'eu-1' },
			{ id: 2, title: 'us-1' },
			{ id: 3, title: 'eu-2' },
			{ id: 4, title: 'us-2' },
			{ id: 5, title: 'changed' },
		]);
	});

	test('relational update by an out-of-scope key matches nothing', async () => {
		const { eu, sqlite } = setup();

		expect(
			await eu.posts.update({
				data: { author: { connect: { id: 1 } }, title: 'x' },
				where: { id: 2 },
			}),
		).toBeNull();
		expect(titles(sqlite)).toEqual(UNCHANGED);
	});

	test('delete never removes out-of-scope rows', async () => {
		const { eu, sqlite } = setup();

		expect(await eu.posts.delete({ where: { id: 4 } })).toBeNull();
		const deleted = await eu.posts.delete({ where: { authorId: 2 } });
		expect(deleted?.id).toBe(5);
		expect(ids(titles(sqlite))).toEqual([1, 2, 3, 4]);
	});

	test('updateMany and deleteMany only affect in-scope rows', async () => {
		const { eu, sqlite } = setup();

		const updated = await eu.posts.updateMany({
			data: { title: 'bulk' },
			where: { id: { in: [1, 2, 4, 5] } },
		});
		expect(updated.count).toBe(2);
		expect(titles(sqlite).map((row) => row.title)).toEqual([
			'bulk',
			'us-1',
			'eu-2',
			'us-2',
			'bulk',
		]);

		const deleted = await eu.posts.deleteMany({
			where: { authorId: { in: [1, 2] } },
		});
		expect(deleted.count).toBe(2);
		expect(ids(titles(sqlite))).toEqual([2, 3, 4]);
	});

	test('updateEach only affects in-scope rows', async () => {
		const { eu, raw, sqlite } = setup();

		const result = await eu.posts.updateEach({
			by: raw._.relations.posts.table.id,
			data: [
				{ id: 1, title: 'each-1' },
				{ id: 2, title: 'each-2' },
			],
			update: { title: (row) => row.title as string },
		});
		expect(result.count).toBe(1);
		expect(titles(sqlite).slice(0, 2)).toEqual([
			{ id: 1, title: 'each-1' },
			{ id: 2, title: 'us-1' },
		]);
	});

	test('an empty where stays a no-op instead of hitting the whole scope', async () => {
		const { eu, sqlite } = setup();

		expect(
			await eu.posts.update({ data: { title: 'x' }, where: {} }),
		).toBeNull();
		expect(await eu.posts.delete({ where: {} })).toBeNull();
		expect(
			await eu.posts.updateMany({ data: { title: 'x' }, where: {} }),
		).toEqual({ count: 0 });
		expect(await eu.posts.deleteMany({ where: {} })).toEqual({ count: 0 });
		expect(await eu.posts.deleteMany()).toEqual({ count: 0 });
		expect(titles(sqlite)).toEqual(UNCHANGED);
	});

	test('$withoutPlugins() writes every matching row', async () => {
		const { eu } = setup();

		const result = await eu.posts.$withoutPlugins().updateMany({
			data: { title: 'all' },
			where: { authorId: 2 },
		});
		expect(result.count).toBe(2);
	});
});

describe('model scopes on inserts', () => {
	const regions = (sqlite: Database, table = 'scope_posts') =>
		sqlite
			.query(`SELECT id, region FROM ${table} WHERE id >= 10 ORDER BY id`)
			.all();
	const count = (sqlite: Database) =>
		(
			sqlite.query('SELECT count(*) AS n FROM scope_posts').get() as {
				n: number;
			}
		).n;
	const post = (id: number, extra: Record<string, unknown> = {}) =>
		({ authorId: 1, id, title: `p${id}`, ...extra }) as never;

	test('create stamps the scope, accepts an equal value, rejects another', async () => {
		const { eu, sqlite } = setup();

		expect((await eu.posts.create({ data: post(10) })).region).toBe('eu');
		await eu.posts.create({ data: post(11, { region: 'eu' }) });
		await expect(
			eu.posts.create({ data: post(12, { region: 'us' }) }),
		).rejects.toThrow('REGION_MISMATCH posts.region');
		expect(regions(sqlite)).toEqual([
			{ id: 10, region: 'eu' },
			{ id: 11, region: 'eu' },
		]);
	});

	test('relational create stamps and rejects a foreign value before writing', async () => {
		const { eu, sqlite } = setup();

		await eu.posts.create({
			data: { ...post(10), author: { connect: { id: 1 } } } as never,
		});
		await expect(
			eu.posts.create({
				data: {
					...post(11, { region: 'us' }),
					author: { connect: { id: 1 } },
				} as never,
			}),
		).rejects.toThrow('REGION_MISMATCH posts.region');
		expect(regions(sqlite)).toEqual([{ id: 10, region: 'eu' }]);
	});

	test('createMany stamps every row and rejects a batch with a foreign value', async () => {
		const { eu, sqlite } = setup();

		const created = await eu.posts.createMany({
			data: [post(10), post(11, { region: 'eu' })],
		});
		expect(created.count).toBe(2);
		await expect(
			eu.posts.createMany({
				batchSize: 1,
				data: [post(12), post(13, { region: 'us' })],
			}),
		).rejects.toThrow('REGION_MISMATCH posts.region');
		expect(regions(sqlite)).toEqual([
			{ id: 10, region: 'eu' },
			{ id: 11, region: 'eu' },
		]);
	});

	test('upsert create branch stamps on the native and read-then-write paths', async () => {
		const { eu, sqlite } = setup();

		const native = await eu.posts.upsert({
			create: post(10),
			update: { title: 'updated' },
			where: { id: 10 },
		});
		expect(native?.region).toBe('eu');
		const fallback = await eu.posts.upsert({
			create: post(11, { region: 'eu' }),
			update: { title: 'updated' },
			where: { title: 'missing' },
		});
		expect(fallback?.region).toBe('eu');
		await expect(
			eu.posts.upsert({
				create: post(12, { region: 'us' }),
				update: { title: 'updated' },
				where: { id: 12 },
			}),
		).rejects.toThrow('REGION_MISMATCH posts.region');
		await expect(
			eu.posts.upsert({
				create: post(13, { region: 'us' }),
				update: { title: 'updated' },
				where: { title: 'missing' },
			}),
		).rejects.toThrow('REGION_MISMATCH posts.region');
		expect(regions(sqlite)).toEqual([
			{ id: 10, region: 'eu' },
			{ id: 11, region: 'eu' },
		]);
	});

	test('upsertMany stamps rows and rejects a foreign value before writing', async () => {
		const { eu, sqlite } = setup();
		const target = 'id';

		const result = await eu.posts.upsertMany({
			data: [post(10), post(11, { region: 'eu' })],
			target,
			update: ['title'],
		});
		expect(result.count).toBe(2);
		await expect(
			eu.posts.upsertMany({
				batchSize: 1,
				data: [post(12), post(13, { region: 'us' })],
				target,
				update: ['title'],
			}),
		).rejects.toThrow('REGION_MISMATCH posts.region');
		expect(regions(sqlite)).toEqual([
			{ id: 10, region: 'eu' },
			{ id: 11, region: 'eu' },
		]);
	});

	test('a client without the scope value cannot insert; a null state does not stamp', async () => {
		const { db, sqlite } = setup();
		const before = count(sqlite);

		await expect(db.posts.create({ data: post(10) })).rejects.toThrow(
			'REGION_REQUIRED posts',
		);
		expect(count(sqlite)).toBe(before);

		await db
			.$anyRegion()
			.posts.create({ data: post(11, { region: 'us' }) });
		expect(regions(sqlite)).toEqual([{ id: 11, region: 'us' }]);
	});
});

describe('immutable model scope columns', () => {
	const region = (sqlite: Database, id: number) =>
		(
			sqlite
				.query('SELECT region FROM scope_posts WHERE id = ?')
				.get(id) as {
				region: string;
			}
		).region;
	const mismatch = 'REGION_MISMATCH posts.region';

	test('update and updateMany reject a scope column change and accept the active value', async () => {
		const { eu, sqlite } = setup();

		await expect(
			eu.posts.update({ data: { region: 'us' }, where: { id: 1 } }),
		).rejects.toThrow(mismatch);
		await expect(
			eu.posts.update({
				data: { author: { connect: { id: 1 } }, region: 'us' } as never,
				where: { id: 1 },
			}),
		).rejects.toThrow(mismatch);
		await expect(
			eu.posts.updateMany({ data: { region: 'us' }, where: { id: 1 } }),
		).rejects.toThrow(mismatch);
		expect(
			(
				await eu.posts.update({
					data: { region: 'eu', title: 'same' },
					where: { id: 1 },
				})
			)?.title,
		).toBe('same');
		expect(region(sqlite, 1)).toBe('eu');
	});

	test('updateEach rejects a resolver that changes a scope column', async () => {
		const { eu, raw, sqlite } = setup();
		const by = raw._.relations.posts.table.id;

		await expect(
			eu.posts.updateEach({
				by,
				data: [
					{ id: 1, region: 'eu' },
					{ id: 3, region: 'us' },
				],
				update: { region: (row) => row.region as string },
			}),
		).rejects.toThrow(mismatch);
		expect(region(sqlite, 3)).toBe('eu');
		const same = await eu.posts.updateEach({
			by,
			data: [{ id: 1, region: 'eu' }],
			update: { region: (row) => row.region as string },
		});
		expect(same.count).toBe(1);
	});

	test('the upsert update branch cannot change a scope column', async () => {
		const { eu, sqlite } = setup();
		const create = { authorId: 1, id: 1, title: 'c' } as never;

		await expect(
			eu.posts.upsert({
				create,
				update: { region: 'us' },
				where: { id: 1 },
			}),
		).rejects.toThrow(mismatch);
		await expect(
			eu.posts.upsert({
				create,
				update: { region: 'us' },
				where: { title: 'eu-1' },
			}),
		).rejects.toThrow(mismatch);
		expect(region(sqlite, 1)).toBe('eu');
	});

	test('upsertMany object and function updates cannot change a scope column', async () => {
		const { eu, sqlite } = setup();
		const data = [{ authorId: 1, id: 1, title: 'c' }] as never;

		await expect(
			eu.posts.upsertMany({
				data,
				target: 'id',
				update: { region: 'us' },
			}),
		).rejects.toThrow(mismatch);
		await expect(
			eu.posts.upsertMany({
				data,
				target: 'id',
				update: ({ excluded }) => ({ region: excluded.region }),
			}),
		).rejects.toThrow(mismatch);
		expect(region(sqlite, 1)).toBe('eu');
	});

	test("upsertMany 'all' and column lists drop scope columns from the update set", async () => {
		const queries: string[] = [];
		const { eu } = setup({ queries });
		const data = [{ authorId: 1, id: 1, title: 'all' }] as never;

		await eu.posts.upsertMany({ data, target: 'id', update: 'all' });
		await eu.posts.upsertMany({
			data,
			target: 'id',
			update: ['title', 'region'],
		});
		const sets = queries
			.filter((query) => query.includes('on conflict'))
			.map(
				(query) =>
					query
						.slice(query.indexOf('do update set'))
						.split(' where ')[0]
						?.split(' returning ')[0],
			);
		expect(sets).toHaveLength(2);
		for (const set of sets) {
			expect(set).toContain('"title" = "excluded"."title"');
			expect(set).not.toContain('"region" =');
		}
		await expect(
			Promise.resolve(
				eu.posts.upsertMany({ data, target: 'id', update: ['region'] }),
			),
		).rejects.toThrow('upsertMany update must affect at least one column.');
	});
});

describe('model scopes on upsert conflicts', () => {
	const row = (sqlite: Database, id: number) =>
		sqlite
			.query('SELECT id, title, region FROM scope_posts WHERE id = ?')
			.get(id);

	test('upsert conflicting with an out-of-scope row throws and leaves it', async () => {
		const { eu, sqlite } = setup();

		await expect(
			eu.posts.upsert({
				create: { authorId: 1, id: 2, title: 'stolen' } as never,
				update: { title: 'stolen' },
				where: { id: 2 },
			}),
		).rejects.toThrow('REGION_MISMATCH posts.region');
		expect(row(sqlite, 2)).toEqual({ id: 2, region: 'us', title: 'us-1' });

		const own = await eu.posts.upsert({
			create: { authorId: 1, id: 1, title: 'mine' } as never,
			update: { title: 'mine' },
			where: { id: 1 },
		});
		expect(own?.title).toBe('mine');
	});

	test('upsertMany skips and does not count out-of-scope conflicts', async () => {
		const { eu, sqlite } = setup();
		const data = [
			{ authorId: 1, id: 1, title: 'mine' },
			{ authorId: 1, id: 2, title: 'stolen' },
			{ authorId: 1, id: 10, title: 'new' },
		] as never;

		const result = await eu.posts.upsertMany({
			data,
			select: { id: true },
			target: 'id',
			update: ['title'],
		});
		expect(result).toEqual({ count: 2, data: [{ id: 1 }, { id: 10 }] });
		expect(row(sqlite, 2)).toEqual({ id: 2, region: 'us', title: 'us-1' });

		const filtered = await eu.posts.upsertMany({
			data: [
				{ authorId: 1, id: 1, title: 'again' },
				{ authorId: 1, id: 2, title: 'again' },
				{ authorId: 1, id: 3, title: 'again' },
			] as never,
			target: 'id',
			update: ['title'],
			where: { id: { not: 3 } },
		});
		expect(filtered.count).toBe(1);
		expect(row(sqlite, 2)).toEqual({ id: 2, region: 'us', title: 'us-1' });
		expect(row(sqlite, 3)).toEqual({ id: 3, region: 'eu', title: 'eu-2' });
	});
});

describe('model scopes on relation writes', () => {
	const miss = 'Relation selector did not match a record.';
	const query = (sqlite: Database, text: string) => sqlite.query(text).all();
	const links = (sqlite: Database) =>
		query(
			sqlite,
			'SELECT post_id AS postId, tag_id AS tagId, region FROM scope_post_tags ORDER BY post_id, tag_id, region',
		);
	const LINKS = [
		{ postId: 1, region: 'eu', tagId: 1 },
		{ postId: 1, region: 'eu', tagId: 2 },
		{ postId: 2, region: 'us', tagId: 2 },
		{ postId: 3, region: 'us', tagId: 1 },
		{ postId: 3, region: 'us', tagId: 2 },
	];

	test('connect to an out-of-scope row fails and writes nothing', async () => {
		const { eu, sqlite } = setup();

		await expect(
			eu.posts.create({
				data: {
					author: { connect: { id: 2 } },
					id: 10,
					title: 'x',
				} as never,
			}),
		).rejects.toThrow(miss);
		await expect(
			eu.posts.update({
				data: { author: { connect: { id: 2 } } },
				where: { id: 1 },
			}),
		).rejects.toThrow(miss);
		await expect(
			eu.users.update({
				data: { posts: { connect: { id: 2 } } },
				where: { id: 1 },
			}),
		).rejects.toThrow(miss);

		expect(
			query(
				sqlite,
				'SELECT id, author_id AS authorId FROM scope_posts ORDER BY id',
			),
		).toEqual([
			{ authorId: 1, id: 1 },
			{ authorId: 2, id: 2 },
			{ authorId: 3, id: 3 },
			{ authorId: 1, id: 4 },
			{ authorId: 2, id: 5 },
		]);
	});

	test('disconnect and set resolve and replace only in-scope rows', async () => {
		const { eu, sqlite } = setup();

		await expect(
			eu.users.update({
				data: { profile: { disconnect: { id: 2 } } },
				where: { id: 1 },
			}),
		).rejects.toThrow(miss);
		await expect(
			eu.users.update({
				data: { posts: { set: [{ id: 1 }, { id: 4 }] } },
				where: { id: 1 },
			}),
		).rejects.toThrow(miss);
		// Post 4 (us) also belongs to user 1 but is outside the scope, so
		// `set` must not detach it.
		await eu.users.update({
			data: { posts: { set: [{ id: 1 }] } },
			where: { id: 1 },
		});
		expect(
			query(
				sqlite,
				'SELECT id FROM scope_posts WHERE author_id = 1 ORDER BY id',
			),
		).toEqual([{ id: 1 }, { id: 4 }]);
	});

	test('many-to-many connect stamps junction rows and checks existence in scope', async () => {
		const { eu, sqlite } = setup();

		await expect(
			eu.posts.update({
				data: { tags: { connect: [{ id: 2 }] } },
				where: { id: 5 },
			}),
		).rejects.toThrow(miss);
		await eu.posts.update({
			data: { tags: { connect: [{ id: 1 }] } },
			where: { id: 5 },
		});
		// The us link (3, 1) is outside the scope, so the eu link is created.
		await eu.posts.update({
			data: { tags: { connect: [{ id: 1 }] } },
			where: { id: 3 },
		});
		expect(links(sqlite)).toEqual([
			{ postId: 1, region: 'eu', tagId: 1 },
			{ postId: 1, region: 'eu', tagId: 2 },
			{ postId: 2, region: 'us', tagId: 2 },
			{ postId: 3, region: 'eu', tagId: 1 },
			{ postId: 3, region: 'us', tagId: 1 },
			{ postId: 3, region: 'us', tagId: 2 },
			{ postId: 5, region: 'eu', tagId: 1 },
		]);
	});

	test('many-to-many set and disconnect only delete in-scope junction rows', async () => {
		const { eu, sqlite } = setup();

		await eu.posts.update({
			data: { tags: { set: [] } },
			where: { id: 3 },
		});
		await eu.posts.update({
			data: { tags: { disconnect: [{ id: 1 }] } },
			where: { id: 3 },
		});
		expect(links(sqlite)).toEqual(LINKS);

		await eu.posts.update({
			data: { tags: { disconnect: [{ id: 1 }] } },
			where: { id: 1 },
		});
		expect(links(sqlite)).toEqual(LINKS.slice(1));
	});

	test('a composite foreign key with a scope column accepts equal values and rejects others', async () => {
		const { eu, sqlite } = setup();

		const created = await eu.listings.create({
			data: { entry: { connect: { id: 1 } }, id: 1, title: 'l' } as never,
		});
		expect(created).toEqual({
			catalogId: 1,
			id: 1,
			region: 'eu',
			title: 'l',
		});
		await expect(
			eu.listings.create({
				data: {
					entry: { connect: { id: 2 } },
					id: 2,
					title: 'l',
				} as never,
			}),
		).rejects.toThrow('REGION_MISMATCH listings.region');
		await expect(
			eu.listings.update({
				data: { entry: { connect: { id: 2 } } },
				where: { id: 1 },
			}),
		).rejects.toThrow('REGION_MISMATCH listings.region');
		expect(
			query(
				sqlite,
				'SELECT id, catalog_id AS catalogId, region FROM scope_listings',
			),
		).toEqual([{ catalogId: 1, id: 1, region: 'eu' }]);
	});
});

describe('model scope session statements', () => {
	const SESSION = 'select ? as session_region';
	const sessions = (queries: string[]) =>
		queries.filter((query) => query === SESSION).length;

	test('clients without session statements keep the non-transactional path', async () => {
		const queries: string[] = [];
		const { eu } = setup({ queries });

		await eu.posts.findMany();
		await eu.posts.updateMany({ data: { title: 'x' }, where: { id: 1 } });

		expect(queries).toHaveLength(2);
		expect(queries).not.toContain('begin');
	});

	test('standalone operations run their session statement in an implicit transaction', async () => {
		const queries: string[] = [];
		const { db, eu } = setup({ queries, session: true });

		expect(
			ids(await eu.posts.findMany({ orderBy: { id: 'asc' } })),
		).toEqual([1, 3, 5]);
		expect(queries[0]).toBe('begin');
		expect(queries[1]).toBe(SESSION);
		expect(queries[2]).toStartWith('select');
		expect(queries[3]).toBe('commit');

		queries.length = 0;
		const updated = await eu.posts.update({
			data: { title: 'x' },
			where: { id: 1 },
		});
		expect(updated?.title).toBe('x');
		expect(queries.slice(0, 2)).toEqual(['begin', SESSION]);
		expect(queries.at(-1)).toBe('commit');

		// No scope value (or a null bypass): no session statement, no transaction.
		queries.length = 0;
		await db.notes.findMany();
		await db.$anyRegion().posts.count();
		expect(queries).toHaveLength(2);
		expect(queries).not.toContain('begin');
	});

	test('a savepoint hands its session state back only when released', async () => {
		const queries: string[] = [];
		const { eu } = setup({ queries, session: true });

		await eu.transaction(async (tx) => {
			await tx
				.transaction(async (inner) => {
					await inner.$inRegion('us').posts.count();
					await inner.rollback();
				})
				.catch(() => undefined);
			// Rolled back: the session still holds eu.
			await tx.posts.count();
			await tx.transaction(async (inner) => {
				await inner.$inRegion('us').posts.count();
			});
			// Released: the session now holds us, so eu runs again.
			await tx.posts.count();
		});
		expect(sessions(queries)).toBe(4);
	});

	test('explicit transactions run the session statement once, savepoints included', async () => {
		const queries: string[] = [];
		const { eu } = setup({ queries, session: true });

		await eu.transaction(async (tx) => {
			await tx.posts.findMany();
			await tx.users.count();
			await tx.transaction(async (inner) => {
				await inner.posts.count();
			});
		});
		expect(sessions(queries)).toBe(1);
		expect(queries.slice(0, 2)).toEqual(['begin', SESSION]);
	});

	test('a narrowed scope inside a transaction runs its own session statement', async () => {
		const queries: string[] = [];
		const { eu } = setup({ queries, session: true });

		const counts = await eu.transaction(async (tx) => [
			await tx.posts.count(),
			await tx.$inRegion('us').posts.count(),
			await tx.$inRegion('us').posts.count(),
			await tx.$inRegion('eu').posts.count(),
		]);
		expect(counts).toEqual([3, 2, 2, 3]);
		// eu at begin, us once (equal states do not run it again), then eu
		// again because the session now holds us.
		expect(sessions(queries)).toBe(3);
	});
});
