import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { Client } from 'pg';

import { better } from '../../src';
import { uuids } from '../../src/plugins/uuid';
import { zod } from '../../src/plugins/zod';

const UUID_V7 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const users = pgTable('better_drizzle_uuid_users', {
	email: text('email').notNull().unique(),
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
});

const relations = defineRelations({ users });

const DATABASE_URL = process.env.DATABASE_URL;

const createClient = (pg: Client) =>
	better(drizzle({ client: pg, relations }), { plugins: [uuids()] });

describe.skipIf(!DATABASE_URL)('better-drizzle/uuid (PostgreSQL)', () => {
	let pg: Client;
	let client: ReturnType<typeof createClient>;

	beforeAll(async () => {
		pg = new Client({ connectionString: DATABASE_URL });
		await pg.connect();
		await pg.query(`
			drop table if exists better_drizzle_uuid_users;
			create table better_drizzle_uuid_users (
				id uuid primary key,
				email text not null unique,
				name text not null
			);
		`);
		client = createClient(pg);
	});

	beforeEach(async () => {
		await pg.query('truncate better_drizzle_uuid_users');
	});

	afterAll(async () => {
		await pg.query('drop table if exists better_drizzle_uuid_users');
		await pg.end();
	});

	test('fills native uuid columns on create and createMany', async () => {
		const created = await client.users.create({
			data: { email: 'a@example.com', name: 'A' },
		});
		const { data } = await client.users.createMany({
			data: [
				{ email: 'b@example.com', name: 'B' },
				{ email: 'c@example.com', name: 'C' },
			],
			select: { id: true },
		});

		expect(created.id).toMatch(UUID_V7);
		expect(data?.[0]?.id).toMatch(UUID_V7);
		expect(data?.[0]?.id < (data?.[1]?.id ?? '')).toBe(true);
		expect(
			await client.users.findUnique({ where: { id: created.id } }),
		).toEqual(created);
	});

	test('upsert and upsertMany keep existing ids', async () => {
		const created = await client.users.upsert({
			create: { email: 'a@example.com', name: 'A' },
			update: { name: 'A2' },
			where: { email: 'a@example.com' },
		});

		await client.users.upsertMany({
			data: [
				{ email: 'a@example.com', name: 'A3' },
				{ email: 'b@example.com', name: 'B' },
			],
			target: 'email',
			update: 'all',
		});

		const rows = await client.users.findMany({ orderBy: { email: 'asc' } });
		expect(rows[0]).toEqual({ ...created, name: 'A3' });
		expect(rows[1]?.id).toMatch(UUID_V7);
	});

	test('zod validates the generated uuid', async () => {
		const db = better(drizzle({ client: pg, relations }), {
			plugins: [uuids(), zod()],
		});

		const created = await db.users.create({
			data: { email: 'z@example.com', name: 'Z' },
		});
		expect(created.id).toMatch(UUID_V7);
		await expect(
			db.users.create({
				data: { email: 'bad@example.com', id: 'nope', name: 'Bad' },
			}),
		).rejects.toMatchObject({ code: 'INVALID_ARGS' });
	});
});
