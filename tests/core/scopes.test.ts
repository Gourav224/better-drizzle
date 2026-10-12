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
