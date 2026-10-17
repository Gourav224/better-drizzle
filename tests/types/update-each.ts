// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import type { Database } from 'bun:sqlite';

import { better } from 'better-drizzle';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const users = sqliteTable('users', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	city: text('city'),
});

declare const client: Database;
const db = better(drizzle({ client, relations: defineRelations({ users }) }));

// Callbacks see the rows passed in `data`, so nullable columns read back as is.
void db.users.updateEach({
	by: users.id,
	data: [
		{ id: 1, name: 'Alice', city: 'New York' },
		{ id: 2, name: 'Bob', city: null },
	],
	update: {
		name: (row) => row.name,
		city: (row) => row.city,
	},
});

void db.users.updateEach({
	by: users.id,
	data: [{ id: 1, name: 'Alice' }],
	update: {
		// @ts-expect-error `city` is not in the source rows, so it may be undefined.
		city: (row) => row.city,
	},
});

void db.users.updateEach({
	by: users.id,
	data: [{ id: 1, name: 'Alice' }],
	update: {
		// @ts-expect-error a number is not a valid `name`.
		name: () => 1,
	},
});
