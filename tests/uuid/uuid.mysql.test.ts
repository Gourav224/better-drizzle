import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { char, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { better } from '../../src';
import { ata } from '../../src/plugins/ata';
import { uuids } from '../../src/plugins/uuid';
import { buuid } from '../../src/plugins/uuid/mysql';

const UUID_V7 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const users = mysqlTable('better_drizzle_uuid_users', {
	email: varchar('email', { length: 255 }).notNull().unique(),
	id: char('id', { length: 36 }).primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
});

const files = mysqlTable('better_drizzle_uuid_files', {
	id: buuid('id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
});

const attachments = mysqlTable('better_drizzle_uuid_attachments', {
	fileId: buuid('file_id').notNull(),
	id: varchar('id', { length: 36 }).primaryKey(),
});

const relations = defineRelations({ attachments, files, users }, (r) => ({
	attachments: {
		file: r.one.files({ from: r.attachments.fileId, to: r.files.id }),
	},
}));

const MYSQL_URL = process.env.MYSQL_URL;

describe.skipIf(!MYSQL_URL)('better-drizzle/uuid (MySQL)', () => {
	let connection: mysql.Connection;
	let db: ReturnType<typeof drizzle<typeof relations>>;

	beforeAll(async () => {
		connection = await mysql.createConnection({
			multipleStatements: true,
			uri: MYSQL_URL,
		});
		await connection.query(`
			drop table if exists better_drizzle_uuid_users, better_drizzle_uuid_files, better_drizzle_uuid_attachments;
			create table better_drizzle_uuid_users (
				id char(36) primary key,
				email varchar(255) not null unique,
				name varchar(255) not null
			);
			create table better_drizzle_uuid_attachments (
				id varchar(36) primary key,
				file_id binary(16) not null
			);
			create table better_drizzle_uuid_files (
				id binary(16) primary key,
				name varchar(255) not null
			);
		`);
		db = drizzle({ client: connection, mode: 'default', relations });
	});

	beforeEach(async () => {
		await connection.query(`
			delete from better_drizzle_uuid_users;
			delete from better_drizzle_uuid_files;
			delete from better_drizzle_uuid_attachments;
		`);
	});

	afterAll(async () => {
		await connection.query(
			'drop table if exists better_drizzle_uuid_users, better_drizzle_uuid_files, better_drizzle_uuid_attachments',
		);
		await connection.end();
	});

	test('fills char(36) ids on create, createMany, and upsert', async () => {
		const client = better(db, { plugins: [uuids()] });

		const created = await client.users.create({
			data: { email: 'a@example.com', name: 'A' },
		});
		const { count } = await client.users.createMany({
			data: [
				{ email: 'b@example.com', name: 'B' },
				{ email: 'c@example.com', name: 'C' },
			],
		});
		const upserted = await client.users.upsert({
			create: { email: 'a@example.com', name: 'A' },
			update: { name: 'A2' },
			where: { email: 'a@example.com' },
		});

		expect(created.id).toMatch(UUID_V7);
		expect(count).toBe(2);
		expect(upserted).toEqual({ ...created, name: 'A2' });
	});

	test('upsertMany fills new rows and targets the id', async () => {
		const client = better(db, { plugins: [uuids()] });
		const created = await client.files.create({ data: { name: 'a' } });

		await client.files.upsertMany({
			data: [{ id: created.id, name: 'a2' }, { name: 'b' }],
			target: 'id',
			update: ['name'],
		});

		const rows = await client.files.findMany({ orderBy: { name: 'asc' } });
		expect(rows[0]).toEqual({ ...created, name: 'a2' });
		expect(rows[1]?.id).toMatch(UUID_V7);
	});

	test('upsertMany on another unique key rejects filled ids', async () => {
		const client = better(db, { plugins: [uuids()] });

		await expect(
			client.users.upsertMany({
				data: [{ email: 'a@example.com', name: 'A' }],
				target: 'email',
				update: 'all',
			}),
		).rejects.toMatchObject({ code: 'INVALID_ARGS' });
	});

	test('stores buuid as binary(16) and filters by string', async () => {
		const client = better(db, { plugins: [ata(), uuids()] });

		const created = await client.files.create({ data: { name: 'report' } });
		const [rows] = await connection.query(
			'select length(id) as size from better_drizzle_uuid_files',
		);

		expect(created.id).toMatch(UUID_V7);
		expect((rows as { size: number }[])[0]?.size).toBe(16);
		expect(
			await client.files.findUnique({ where: { id: created.id } }),
		).toEqual(created);
		expect(
			await client.files.findMany({
				where: { id: { in: [created.id] } },
			}),
		).toEqual([created]);
	});

	test('buuid decodes nested relations in Drizzle relational queries', async () => {
		const client = better(db, { plugins: [uuids()] });
		const file = await client.files.create({ data: { name: 'report' } });
		await client.attachments.create({
			data: { fileId: file.id, id: 'a1' },
		});

		const [row] = await db.query.attachments.findMany({
			with: { file: true },
		});
		expect(row?.file).toEqual(file);
	});
});
