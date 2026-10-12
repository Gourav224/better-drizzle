import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { better } from '../../src';
import { regionPlugin } from './scopes.fixture';

const items = mysqlTable('better_drizzle_scope_items', {
	id: int('id').primaryKey(),
	region: varchar('region', { length: 8 }).notNull(),
	title: varchar('title', { length: 64 }).notNull(),
});

const codes = mysqlTable('better_drizzle_scope_codes', {
	id: int('id').primaryKey().autoincrement(),
	region: varchar('region', { length: 8 }).notNull(),
	sku: varchar('sku', { length: 16 }).notNull().unique(),
	title: varchar('title', { length: 64 }).notNull(),
});

const relations = defineRelations({ codes, items });

const MYSQL_URL = process.env.MYSQL_URL;

describe.skipIf(!MYSQL_URL)('model scopes (MySQL)', () => {
	let connection: mysql.Connection;
	let db: ReturnType<typeof createClient>;

	const createClient = (client: mysql.Connection) =>
		better(drizzle({ client, mode: 'default', relations }), {
			plugins: [regionPlugin()],
		});

	const rows = async (table: string) =>
		(
			await connection.query(
				`select id, title, region from ${table} order by id`,
			)
		)[0];

	beforeAll(async () => {
		connection = await mysql.createConnection({
			multipleStatements: true,
			uri: MYSQL_URL,
		});
		await connection.query(`
			drop table if exists better_drizzle_scope_items, better_drizzle_scope_codes;
			create table better_drizzle_scope_items (
				id int primary key,
				title varchar(64) not null,
				region varchar(8) not null
			);
			create table better_drizzle_scope_codes (
				id int primary key auto_increment,
				sku varchar(16) not null unique,
				title varchar(64) not null,
				region varchar(8) not null
			);
		`);
		db = createClient(connection);
	});

	beforeEach(async () => {
		await connection.query(`
			delete from better_drizzle_scope_items;
			delete from better_drizzle_scope_codes;
			insert into better_drizzle_scope_items values
				(1, 'eu-1', 'eu'), (2, 'us-1', 'us'), (3, 'eu-2', 'eu');
			insert into better_drizzle_scope_codes values
				(1, 'a', 'eu-1', 'eu'), (2, 'b', 'us-1', 'us');
		`);
	});

	afterAll(async () => {
		await connection.query(
			'drop table if exists better_drizzle_scope_items, better_drizzle_scope_codes',
		);
		await connection.end();
	});

	test('scoped upsert reads inside the scope and never touches other scopes', async () => {
		const eu = db.$inRegion('eu');

		const own = await eu.items.upsert({
			create: { id: 1, title: 'mine' } as never,
			update: { title: 'mine' },
			where: { id: 1 },
		});
		expect(own).toEqual({ id: 1, region: 'eu', title: 'mine' });

		const created = await eu.items.upsert({
			create: { id: 4, title: 'new' } as never,
			update: { title: 'new' },
			where: { id: 4 },
		});
		expect(created).toEqual({ id: 4, region: 'eu', title: 'new' });

		// The scoped read misses row 2, so the create branch hits its key.
		await expect(
			eu.items.upsert({
				create: { id: 2, title: 'stolen' } as never,
				update: { title: 'stolen' },
				where: { id: 2 },
			}),
		).rejects.toMatchObject({ cause: { code: 'ER_DUP_ENTRY' } });
		await expect(
			eu.codes.upsert({
				create: { sku: 'b', title: 'stolen' } as never,
				update: { title: 'stolen' },
				where: { sku: 'b' },
			}),
		).rejects.toMatchObject({ cause: { code: 'ER_DUP_ENTRY' } });

		expect(await rows('better_drizzle_scope_items')).toEqual([
			{ id: 1, region: 'eu', title: 'mine' },
			{ id: 2, region: 'us', title: 'us-1' },
			{ id: 3, region: 'eu', title: 'eu-2' },
			{ id: 4, region: 'eu', title: 'new' },
		]);
		expect(await rows('better_drizzle_scope_codes')).toEqual([
			{ id: 1, region: 'eu', title: 'eu-1' },
			{ id: 2, region: 'us', title: 'us-1' },
		]);
	});

	test('upsertMany leaves cross-scope rows unchanged through IF() sets', async () => {
		const eu = db.$inRegion('eu');

		const result = await eu.items.upsertMany({
			data: [
				{ id: 1, title: 'mine' },
				{ id: 2, title: 'stolen' },
				{ id: 4, title: 'new' },
			] as never,
			target: 'id',
			update: 'all',
		});
		const listed = await eu.items.upsertMany({
			data: [{ id: 2, title: 'again' }] as never,
			target: 'id',
			update: { title: 'object' },
		});

		// MySQL counts the rows sent, including the unchanged cross-scope row.
		expect(result.count).toBe(3);
		expect(listed.count).toBe(1);
		expect(await rows('better_drizzle_scope_items')).toEqual([
			{ id: 1, region: 'eu', title: 'mine' },
			{ id: 2, region: 'us', title: 'us-1' },
			{ id: 3, region: 'eu', title: 'eu-2' },
			{ id: 4, region: 'eu', title: 'new' },
		]);
	});

	test('single-row writes lock and write only in-scope rows', async () => {
		const eu = db.$inRegion('eu');

		expect(
			await eu.items.update({ data: { title: 'x' }, where: { id: 2 } }),
		).toBeNull();
		const updated = await eu.transaction((tx) =>
			tx.items.update({
				data: { title: 'locked' },
				where: { title: { in: ['us-1', 'eu-2'] } },
			}),
		);
		expect(updated?.id).toBe(3);
		const unlocked = await eu.items.update({
			data: { title: 'implicit' },
			where: { title: { in: ['us-1', 'eu-1'] } },
		});
		expect(unlocked?.id).toBe(1);
		const deleted = await eu.items.delete({
			where: { title: { in: ['us-1', 'implicit'] } },
		});
		expect(deleted?.id).toBe(1);
		const many = await eu.items.updateMany({
			data: { title: 'bulk' },
			where: { id: { in: [2, 3] } },
		});
		expect(many.count).toBe(1);

		expect(await rows('better_drizzle_scope_items')).toEqual([
			{ id: 2, region: 'us', title: 'us-1' },
			{ id: 3, region: 'eu', title: 'bulk' },
		]);
	});
});
