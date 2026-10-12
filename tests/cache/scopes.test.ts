import { describe, expect, test } from 'bun:test';

import { drizzle } from 'drizzle-orm/bun-sqlite';

import { better, param } from '../../src';
import { cache } from '../../src/plugins/cache';
import { createTenantDb, ids, relations } from '../tenant/fixture';
import { createMemoryStore } from './memory-store';

const entryKeys = (values: Map<string, unknown>) =>
	[...values.keys()].filter((key) => key.includes(':q:')).sort();

describe('better-drizzle/cache with model scopes', () => {
	test('CACHE-01/02: each tenant gets its own cached result', async () => {
		const memory = createMemoryStore();
		const queries: string[] = [];
		const { db } = createTenantDb(
			{},
			{ plugins: [cache({ store: memory.store, ttl: 60 })], queries },
		);
		const a = db.$tenant({ organizationId: 'a' });
		const b = db.$tenant({ organizationId: 'b' });
		const read = (client: typeof a) =>
			client.projects.findMany({ cache: true });

		expect(ids(await read(a))).toEqual([1, 2]);
		expect(ids(await read(b))).toEqual([3]);
		const misses = queries.length;
		expect(entryKeys(memory.values)).toHaveLength(2);

		expect(ids(await read(a))).toEqual([1, 2]);
		expect(ids(await read(b))).toEqual([3]);
		// A fresh scoped client with equal values reuses the entry.
		expect(ids(await read(db.$tenant({ organizationId: 'a' })))).toEqual([
			1, 2,
		]);
		expect(queries.length).toBe(misses);
	});

	test('CACHE-01: prepared reads key by scope too', async () => {
		const memory = createMemoryStore();
		const { db } = createTenantDb(
			{},
			{ plugins: [cache({ store: memory.store, ttl: 60 })] },
		);
		const prepare = (organizationId: string) =>
			db
				.$tenant({ organizationId })
				.projects.findMany({
					cache: true,
					where: { name: { startsWith: param('prefix') } },
				})
				.prepare();

		expect(ids(await prepare('a').execute({ prefix: '' }))).toEqual([1, 2]);
		expect(ids(await prepare('b').execute({ prefix: '' }))).toEqual([3]);
		expect(entryKeys(memory.values)).toHaveLength(2);
	});

	test('custom read keys cannot share an entry across tenants', async () => {
		const memory = createMemoryStore();
		const { db } = createTenantDb(
			{},
			{ plugins: [cache({ store: memory.store, ttl: 60 })] },
		);
		const a = db.$tenant({ organizationId: 'a' });
		const b = db.$tenant({ organizationId: 'b' });

		expect(ids(await a.projects.findMany({ cache: 'shared-key' }))).toEqual(
			[1, 2],
		);
		expect(ids(await b.projects.findMany({ cache: 'shared-key' }))).toEqual(
			[3],
		);
		expect(ids(await a.projects.findMany({ cache: 'shared-key' }))).toEqual(
			[1, 2],
		);
	});

	test('manual custom-key invalidation refreshes scoped entries', async () => {
		const memory = createMemoryStore();
		const { db, sqlite } = createTenantDb(
			{},
			{ plugins: [cache({ store: memory.store, ttl: 60 })] },
		);
		const a = db.$tenant({ organizationId: 'a' });
		const b = db.$tenant({ organizationId: 'b' });

		expect(ids(await a.projects.findMany({ cache: 'projects' }))).toEqual([
			1, 2,
		]);
		expect(ids(await b.projects.findMany({ cache: 'projects' }))).toEqual([
			3,
		]);
		sqlite.exec("insert into t_projects values (4, 'a-p3', 'a')");
		expect(ids(await a.projects.findMany({ cache: 'projects' }))).toEqual([
			1, 2,
		]);

		await db.$cache.invalidate({ keys: ['projects'] });
		expect(ids(await a.projects.findMany({ cache: 'projects' }))).toEqual([
			1, 2, 4,
		]);
		expect(ids(await b.projects.findMany({ cache: 'projects' }))).toEqual([
			3,
		]);
	});

	test('unscoped reads keep the same keys as a client without scopes', async () => {
		const scopedStore = createMemoryStore();
		const plainStore = createMemoryStore();
		const { db, sqlite } = createTenantDb(
			{},
			{ plugins: [cache({ store: scopedStore.store, ttl: 60 })] },
		);
		const plain = better(drizzle({ client: sqlite, relations }), {
			plugins: [cache({ store: plainStore.store, ttl: 60 })],
		});

		await db.plans.findMany({ cache: true });
		await plain.plans.findMany({ cache: true });

		expect(entryKeys(scopedStore.values)).toEqual(
			entryKeys(plainStore.values),
		);
		expect(entryKeys(plainStore.values)).toHaveLength(1);
	});
});
