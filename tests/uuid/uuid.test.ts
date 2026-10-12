import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { ata } from '../../src/plugins/ata';
import { timestamps } from '../../src/plugins/timestamps';
import { uuids, uuidv4, uuidv7 } from '../../src/plugins/uuid';
import { buuid } from '../../src/plugins/uuid/sqlite';
import { zod } from '../../src/plugins/zod';

const UUID_V7 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const users = sqliteTable('uuid_users', {
	email: text('email').notNull().unique(),
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	updatedAt: text('updated_at'),
});

const files = sqliteTable('uuid_files', {
	id: buuid('id').primaryKey(),
	name: text('name').notNull(),
});

const counters = sqliteTable('uuid_counters', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const tokens = sqliteTable('uuid_tokens', {
	key: text('key').primaryKey(),
	name: text('name').notNull(),
});

const attachments = sqliteTable('uuid_attachments', {
	fileId: buuid('file_id').notNull(),
	id: text('id').primaryKey(),
});

const schema = { attachments, counters, files, tokens, users };
const relations = defineRelations(schema, (r) => ({
	attachments: {
		file: r.one.files({ from: r.attachments.fileId, to: r.files.id }),
	},
}));

const createContext = () => {
	const sqlite = new Database(':memory:');

	sqlite.exec(`
		CREATE TABLE uuid_users (
			id TEXT PRIMARY KEY NOT NULL,
			email TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			updated_at TEXT
		);
		CREATE TABLE uuid_files (
			id BLOB PRIMARY KEY NOT NULL,
			name TEXT NOT NULL
		);
		CREATE TABLE uuid_counters (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL
		);
		CREATE TABLE uuid_attachments (
			id TEXT PRIMARY KEY NOT NULL,
			file_id BLOB NOT NULL
		);
		CREATE TABLE uuid_tokens (
			key TEXT PRIMARY KEY NOT NULL,
			name TEXT NOT NULL
		);
	`);

	return {
		db: drizzle({ client: sqlite, relations }),
		sqlite,
		[Symbol.dispose]() {
			sqlite.close();
		},
	};
};

describe('uuidv7', () => {
	test('writes version 7 and the RFC 9562 variant', () => {
		for (let index = 0; index < 1000; index += 1)
			expect(uuidv7()).toMatch(UUID_V7);
	});

	test('encodes the current Unix millisecond', () => {
		const before = Date.now();
		const id = uuidv7();
		const after = Date.now();
		const ms = Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);

		expect(ms).toBeGreaterThanOrEqual(before);
		expect(ms).toBeLessThanOrEqual(after + 1);
	});

	test('sorts in creation order within the same millisecond', () => {
		const ids = Array.from({ length: 10_000 }, () => uuidv7());

		expect(new Set(ids).size).toBe(ids.length);
		expect([...ids].sort()).toEqual(ids);
	});

	test('uuidv4 writes version 4', () => {
		expect(uuidv4()).toMatch(UUID_V4);
	});
});

describe('better-drizzle/uuid', () => {
	test('fills a missing id on create and keeps explicit ids', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids()] });

		const created = await db.users.create({
			data: { email: 'a@example.com', name: 'A' },
		});
		expect(created.id).toMatch(UUID_V7);

		const explicit = await db.users.create({
			data: { email: 'b@example.com', id: 'custom', name: 'B' },
		});
		expect(explicit.id).toBe('custom');
	});

	test('fills ordered ids on createMany', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids()] });

		const { count, data } = await db.users.createMany({
			data: [
				{ email: 'a@example.com', name: 'A' },
				{ email: 'b@example.com', name: 'B' },
				{ email: 'c@example.com', id: 'kept', name: 'C' },
			],
			select: { id: true },
		});
		const ids = data?.map((row) => row.id) ?? [];

		expect(count).toBe(3);
		expect(ids[0]).toMatch(UUID_V7);
		expect(ids[1]).toMatch(UUID_V7);
		expect(ids[0] < ids[1]).toBe(true);
		expect(ids[2]).toBe('kept');
	});

	test('fills the create branch of upsert', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids()] });

		const created = await db.users.upsert({
			create: { email: 'a@example.com', name: 'A' },
			update: { name: 'A2' },
			where: { email: 'a@example.com' },
		});
		expect(created.id).toMatch(UUID_V7);

		const updated = await db.users.upsert({
			create: { email: 'a@example.com', name: 'A' },
			update: { name: 'A2' },
			where: { email: 'a@example.com' },
		});
		expect(updated.id).toBe(created.id);
		expect(updated.name).toBe('A2');
	});

	test('upsertMany with update all keeps existing ids on conflict', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids()] });
		const existing = await db.users.create({
			data: { email: 'a@example.com', name: 'A' },
		});

		await db.users.upsertMany({
			data: [
				{ email: 'a@example.com', name: 'A2' },
				{ email: 'b@example.com', name: 'B' },
			],
			target: 'email',
			update: 'all',
		});

		const rows = await db.users.findMany({ orderBy: { email: 'asc' } });
		expect(rows[0]).toEqual({ ...existing, name: 'A2' });
		expect(rows[1]?.id).toMatch(UUID_V7);
	});

	test('generates version 4 when configured', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids({ version: 4 })] });

		const created = await db.users.create({
			data: { email: 'a@example.com', name: 'A' },
		});
		expect(created.id).toMatch(UUID_V4);
	});

	test('skips non-string id columns', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids()] });

		const created = await db.counters.create({ data: { name: 'auto' } });
		expect(created.id).toBe(1);
	});

	test('applies model overrides and opt-outs', async () => {
		using ctx = createContext();
		const db = better(ctx.db, {
			plugins: [uuids({ models: { tokens: 'key', users: false } })],
		});

		const token = await db.tokens.create({ data: { name: 'T' } });
		expect(token.key).toMatch(UUID_V7);

		await expect(
			Promise.resolve(
				db.users.create({
					data: { email: 'a@example.com', name: 'A' } as never,
				}),
			),
		).rejects.toThrow(/values \(\?, null,/);
	});

	test('fails fast on a missing or non-string override', () => {
		using ctx = createContext();

		expect(() =>
			better(ctx.db, {
				plugins: [uuids({ models: { users: 'missing' } })],
			}),
		).toThrow(
			expect.objectContaining({
				code: 'PLUGIN_REQUIRED_COLUMN_MISSING',
				column: 'missing',
				table: 'users',
			}),
		);
		expect(() =>
			better(ctx.db, {
				plugins: [uuids({ models: { counters: 'id' } })],
			}),
		).toThrow(
			expect.objectContaining({
				code: 'PLUGIN_REQUIRED_COLUMN_TYPE',
				column: 'id',
				table: 'counters',
			}),
		);
	});

	test('exposes generated columns to plugins', () => {
		using ctx = createContext();
		let generated: Record<string, readonly string[]> = {};
		better(ctx.db, {
			plugins: [
				{
					id: 'probe',
					setup({ models }) {
						generated = Object.fromEntries(
							Object.entries(models).map(([name, model]) => [
								name,
								model.generated,
							]),
						);
					},
				},
				uuids(),
			],
		});

		expect(generated).toEqual({
			attachments: ['id'],
			counters: [],
			files: ['id'],
			tokens: [],
			users: ['id'],
		});
	});

	test('stores buuid columns as 16 bytes and filters by string', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids()] });

		const created = await db.files.create({ data: { name: 'report' } });
		expect(created.id).toMatch(UUID_V7);

		const raw = ctx.sqlite
			.query('SELECT length(id) AS size FROM uuid_files')
			.get() as { size: number };
		expect(raw.size).toBe(16);

		expect(
			await db.files.findUnique({ where: { id: created.id } }),
		).toEqual(created);
		expect(
			await db.files.findMany({ where: { id: { in: [created.id] } } }),
		).toEqual([created]);
		await expect(
			Promise.resolve(db.files.findMany({ where: { id: 'not-a-uuid' } })),
		).rejects.toThrow();
	});

	test('timestamps before uuids keeps ids on upsertMany conflicts', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [timestamps(), uuids()] });
		const existing = await db.users.create({
			data: { email: 'a@example.com', name: 'A' },
		});

		await db.users.upsertMany({
			data: [{ email: 'a@example.com', name: 'A2' }],
			target: 'email',
			update: 'all',
		});
		await db.users.upsertMany({
			data: [{ email: 'a@example.com', name: 'A3' }],
			target: 'email',
			update: ['id', 'name'],
		});

		expect(
			await db.users.findMany({ select: { id: true, name: true } }),
		).toEqual([{ id: existing.id, name: 'A3' }]);
	});

	test('upsert inserts the id pinned by where', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids()] });
		const id = uuidv7();

		const created = await db.users.upsert({
			create: { email: 'a@example.com', name: 'A' },
			update: { name: 'A2' },
			where: { id },
		});
		expect(created.id).toBe(id);
	});

	test('does not fill columns that only another plugin generates', async () => {
		using ctx = createContext();
		const db = better(ctx.db, {
			plugins: [{ generated: { column: 'id' }, id: 'other' }, uuids()],
		});

		const created = await db.counters.create({ data: { name: 'auto' } });
		expect(created.id).toBe(1);
	});

	test('buuid decodes nested relations in Drizzle relational queries', async () => {
		using ctx = createContext();
		const db = better(ctx.db, { plugins: [uuids()] });
		const file = await db.files.create({ data: { name: 'report' } });
		await db.attachments.create({ data: { fileId: file.id, id: 'a1' } });

		const [row] = await ctx.db.query.attachments.findMany({
			with: { file: true },
		});
		expect(row?.file).toEqual(file);
	});

	test.each([
		['zod', zod],
		['ata', ata],
	] as const)(
		'%s treats generated ids as optional on create',
		async (_, validator) => {
			using ctx = createContext();

			for (const plugins of [
				[validator(), uuids()],
				[uuids(), validator()],
			]) {
				const db = better(ctx.db, { plugins });
				const created = await db.users.create({
					data: { email: `${plugins[0]?.id}@example.com`, name: 'A' },
				});
				expect(created.id).toMatch(UUID_V7);

				const file = await db.files.create({
					data: { name: 'report' },
				});
				expect(file.id).toMatch(UUID_V7);
				expect(
					await db.files.findUnique({ where: { id: file.id } }),
				).toEqual(file);
			}
		},
	);
});
