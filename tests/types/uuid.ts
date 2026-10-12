// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import type { Database } from 'bun:sqlite';

import { better } from 'better-drizzle';
import { timestamps } from 'better-drizzle/timestamps';
import { uuids } from 'better-drizzle/uuid';
import { buuid } from 'better-drizzle/uuid/sqlite';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
});
const files = sqliteTable('files', {
	id: buuid('id').primaryKey(),
	name: text('name').notNull(),
});
const counters = sqliteTable('counters', {
	id: integer('id').notNull(),
	name: text('name').notNull(),
});
const tokens = sqliteTable('tokens', {
	key: text('key').primaryKey(),
	name: text('name').notNull(),
});

declare const client: Database;

const raw = drizzle({
	client,
	relations: defineRelations({ counters, files, tokens, users }),
});

const db = better(raw, { plugins: [timestamps(), uuids()] });

db.users.create({ data: { name: 'A' } });
db.users.create({ data: { id: 'custom', name: 'A' } });
db.users.createMany({ data: [{ name: 'A' }, { id: 'b', name: 'B' }] });
db.users.upsert({
	create: { name: 'A' },
	update: { name: 'B' },
	where: { name: 'A' },
});
db.users.upsertMany({ data: [{ name: 'A' }], target: 'id', update: 'all' });
db.files.create({ data: { name: 'report' } });
db.files.findMany({
	where: { id: { in: ['0190b3b4-0000-7000-8000-000000000000'] } },
});
// @ts-expect-error tokens has no `id` column, so `key` stays required.
db.tokens.create({ data: { name: 'T' } });
// @ts-expect-error Non-string ids are never filled, so they stay required.
db.counters.create({ data: { name: 'C' } });
// @ts-expect-error Generated columns keep their value type.
db.users.create({ data: { id: 1, name: 'A' } });

const overridden = better(raw, {
	plugins: [uuids({ models: { tokens: 'key', users: false } })],
});

overridden.tokens.create({ data: { name: 'T' } });
overridden.files.create({ data: { name: 'report' } });
// @ts-expect-error users opted out, so `id` is required.
overridden.users.create({ data: { name: 'A' } });

const plain = better(raw);
// @ts-expect-error Without uuids() the id is required.
plain.users.create({ data: { name: 'A' } });
