import { Database } from 'bun:sqlite';

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { runAdapterSuite } from './suite';

const connection = new Database(':memory:');

await runAdapterSuite({
	connection,
	dialect: 'sqlite',
	drizzle: (relations) => drizzle({ client: connection, relations }),
	placeholder: { placeholder: sqliteTable('placeholder', { id: text() }) },
	reset: async () => {
		const tables = connection
			.query("select name from sqlite_master where type = 'table'")
			.all() as { name: string }[];
		for (const { name } of tables) connection.run(`drop table "${name}"`);
	},
});
