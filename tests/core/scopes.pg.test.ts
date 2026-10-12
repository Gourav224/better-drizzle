import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { defineRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { Client } from 'pg';

import { better } from '../../src';
import { regionPlugin } from './scopes.fixture';

const items = pgTable('better_drizzle_scope_items', {
	id: integer('id').primaryKey(),
	region: text('region').notNull(),
	sku: text('sku').notNull().unique(),
	title: text('title').notNull(),
});

// A view whose only row carries the session setting as its region: scoped
// reads see it only when `set_config('app.region', ...)` ran first.
const settings = pgTable('better_drizzle_scope_settings', {
	id: integer('id').primaryKey(),
	region: text('region'),
});

const audits = pgTable('better_drizzle_scope_audits', {
	id: integer('id').primaryKey(),
	region: text('region').notNull(),
	setting: text('setting'),
});

const relations = defineRelations({ audits, items, settings });

const DATABASE_URL = process.env.DATABASE_URL;

const createClient = (pg: Client, session = false, queries?: string[]) =>
	better(
		drizzle({
			client: pg,
			logger: queries
				? { logQuery: (query) => queries.push(query) }
				: false,
			relations,
		}),
		{ plugins: [regionPlugin([], { session })] },
	);

const SETTING = sql`current_setting('app.region', true)`;

describe.skipIf(!DATABASE_URL)('model scopes (PostgreSQL)', () => {
	let pg: Client;
	let db: ReturnType<typeof createClient>;

	const row = async (id: number) =>
		(
			await pg.query(
				'select id, sku, title, region from better_drizzle_scope_items where id = $1',
				[id],
			)
		).rows[0];

	beforeAll(async () => {
		pg = new Client({ connectionString: DATABASE_URL });
		await pg.connect();
		await pg.query(`
			drop table if exists better_drizzle_scope_items;
			create table better_drizzle_scope_items (
				id integer primary key,
				sku text not null unique,
				title text not null,
				region text not null
			);
			drop view if exists better_drizzle_scope_settings;
			create view better_drizzle_scope_settings as
				select 1 as id, current_setting('app.region', true) as region;
			drop table if exists better_drizzle_scope_audits;
			create table better_drizzle_scope_audits (
				id integer primary key,
				region text not null,
				setting text default current_setting('app.region', true)
			);
		`);
		db = createClient(pg);
	});

	beforeEach(async () => {
		await pg.query(`
			truncate better_drizzle_scope_items, better_drizzle_scope_audits;
			insert into better_drizzle_scope_items values
				(1, 'a', 'eu-1', 'eu'), (2, 'b', 'us-1', 'us'), (3, 'c', 'eu-2', 'eu');
		`);
	});

	afterAll(async () => {
		await pg.query(`
			drop table if exists better_drizzle_scope_items, better_drizzle_scope_audits;
			drop view if exists better_drizzle_scope_settings;
		`);
		await pg.end();
	});

	test('upsert by primary key or unique key never updates another scope', async () => {
		const eu = db.$inRegion('eu');

		await expect(
			eu.items.upsert({
				create: { id: 2, sku: 'b', title: 'stolen' } as never,
				update: { title: 'stolen' },
				where: { id: 2 },
			}),
		).rejects.toThrow('REGION_MISMATCH items.region');
		await expect(
			eu.items.upsert({
				create: { id: 9, sku: 'b', title: 'stolen' } as never,
				update: { title: 'stolen' },
				where: { sku: 'b' },
			}),
		).rejects.toThrow('REGION_MISMATCH items.region');
		expect(await row(2)).toEqual({
			id: 2,
			region: 'us',
			sku: 'b',
			title: 'us-1',
		});

		const own = await eu.items.upsert({
			create: { id: 1, sku: 'a', title: 'mine' } as never,
			update: { title: 'mine' },
			where: { id: 1 },
		});
		expect(own).toEqual({ id: 1, region: 'eu', sku: 'a', title: 'mine' });
		const created = await eu.items.upsert({
			create: { id: 4, sku: 'd', title: 'new' } as never,
			update: { title: 'new' },
			where: { id: 4 },
		});
		expect(created?.region).toBe('eu');
	});

	test('upsertMany skips and does not count out-of-scope conflicts', async () => {
		const eu = db.$inRegion('eu');

		const result = await eu.items.upsertMany({
			data: [
				{ id: 1, sku: 'a', title: 'mine' },
				{ id: 2, sku: 'b', title: 'stolen' },
				{ id: 4, sku: 'd', title: 'new' },
			] as never,
			select: { id: true, region: true },
			target: 'id',
			update: 'all',
		});

		expect(result.count).toBe(2);
		expect(
			result.data?.toSorted((left, right) => left.id - right.id),
		).toEqual([
			{ id: 1, region: 'eu' },
			{ id: 4, region: 'eu' },
		]);
		expect(await row(2)).toEqual({
			id: 2,
			region: 'us',
			sku: 'b',
			title: 'us-1',
		});
	});

	test('session statements are visible inside standalone reads and writes', async () => {
		const plain = db.$inRegion('eu');
		expect(await plain.settings.findMany()).toEqual([]);

		const eu = createClient(pg, true).$inRegion('eu');
		expect(await eu.settings.findMany()).toEqual([{ id: 1, region: 'eu' }]);

		await eu.audits.create({ data: { id: 1 } as never });
		await eu.audits.createMany({ data: [{ id: 2 }] as never });
		await eu.audits.updateMany({
			data: { setting: SETTING as never },
			where: { id: 2 },
		});
		expect(
			(
				await pg.query(
					'select id, setting from better_drizzle_scope_audits order by id',
				)
			).rows,
		).toEqual([
			{ id: 1, setting: 'eu' },
			{ id: 2, setting: 'eu' },
		]);
		// Settings are transaction-local: nothing leaks to the connection.
		expect(
			(await pg.query("select current_setting('app.region', true) as v"))
				.rows[0].v,
		).toBeOneOf([null, '']);
	});

	test('explicit transactions set the session once and keep it for raw SQL', async () => {
		const queries: string[] = [];
		const eu = createClient(pg, true, queries).$inRegion('eu');

		const seen = await eu.transaction(async (tx) => {
			const raw =
				(await tx.$raw`select current_setting('app.region', true) as v`) as unknown as
					| { rows: { v: string }[] }
					| { v: string }[];
			const rows = Array.isArray(raw) ? raw : raw.rows;
			const first = await tx.settings.findMany();
			const nested = await tx.transaction((inner) =>
				inner.settings.count(),
			);
			const narrowed = await tx.$inRegion('us').settings.findMany();
			return { first, narrowed, nested, raw: rows[0]?.v };
		});

		expect(seen).toEqual({
			first: [{ id: 1, region: 'eu' }],
			narrowed: [{ id: 1, region: 'us' }],
			nested: 1,
			raw: 'eu',
		});
		expect(
			queries.filter((query) => query.includes('set_config')),
		).toHaveLength(2);
	});
});
