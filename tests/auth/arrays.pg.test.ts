import { afterAll, describe, expect, test } from 'bun:test';

import { better } from 'better-drizzle';
import { adapter } from 'better-drizzle/auth';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { boolean, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA = 'better_drizzle_auth_arrays';

const auth = pgSchema(SCHEMA);
const user = auth.table('user', {
	id: text().primaryKey(),
	name: text().notNull(),
	email: text().notNull().unique(),
	emailVerified: boolean().notNull().default(false),
	image: text(),
	tags: text().array().notNull(),
	createdAt: timestamp().notNull(),
	updatedAt: timestamp().notNull(),
});

describe.skipIf(!DATABASE_URL)(
	'better-drizzle/auth arrays (PostgreSQL)',
	() => {
		const pool = new Pool({ connectionString: DATABASE_URL });
		afterAll(async () => {
			await pool.query(`drop schema if exists ${SCHEMA} cascade`);
			await pool.end();
		});

		test('string[] fields use native text[] columns', async () => {
			await pool.query(`drop schema if exists ${SCHEMA} cascade`);
			await pool.query(`create schema ${SCHEMA}`);
			await pool.query(
				`create table ${SCHEMA}."user" (id text primary key, name text not null, email text not null unique, "emailVerified" boolean not null default false, image text, tags text[] not null, "createdAt" timestamp not null, "updatedAt" timestamp not null)`,
			);
			const db = better(
				drizzle({ client: pool, relations: defineRelations({ user }) }),
			);
			const instance = adapter(db)({
				user: { additionalFields: { tags: { type: 'string[]' } } },
			});

			const created = await instance.create<Record<string, unknown>>({
				data: {
					email: 'ada@example.com',
					emailVerified: false,
					name: 'Ada',
					tags: ['admin', 'beta'],
				},
				model: 'user',
			});
			const found = await instance.findOne<{ tags: string[] }>({
				model: 'user',
				where: [{ field: 'id', value: created.id as string }],
			});

			expect(created.tags).toEqual(['admin', 'beta']);
			expect(found?.tags).toEqual(['admin', 'beta']);
		});
	},
);
