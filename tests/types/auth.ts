import { Database } from 'bun:sqlite';

import { betterAuth } from 'better-auth';
import { better } from 'better-drizzle';
import { adapter, betterDrizzleAdapter } from 'better-drizzle/auth';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

const user = sqliteTable('user', { id: text().primaryKey() });
const db = better(
	drizzle({
		client: new Database(':memory:'),
		relations: defineRelations({ user }),
	}),
);

betterAuth({ database: adapter(db) });
betterAuth({
	database: betterDrizzleAdapter(db, {
		cache: true,
		debugLogs: true,
		meta: { source: 'better-auth' },
		transaction: false,
		usePlural: false,
	}),
});

// @ts-expect-error -- unknown option
adapter(db, { provider: 'sqlite' });
