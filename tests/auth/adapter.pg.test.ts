import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

import { runAdapterSuite } from './suite';

const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA = 'better_drizzle_auth';

if (DATABASE_URL) {
	// Better Auth's tables live in their own schema, so `user` and friends do
	// not collide with other suites sharing the database.
	const connection = new Pool({
		connectionString: DATABASE_URL,
		options: `-c search_path=${SCHEMA}`,
	});

	await runAdapterSuite({
		connection,
		dialect: 'pg',
		// Better Auth's migrator stores `string[]` as jsonb while the generated
		// Drizzle schema uses text[]; `arrays.pg.test.ts` covers native arrays.
		disable: { 'create - should support arrays': true },
		drizzle: (relations) => drizzle({ client: connection, relations }),
		placeholder: { placeholder: pgTable('placeholder', { id: text() }) },
		reset: async () => {
			await connection.query(`drop schema if exists ${SCHEMA} cascade`);
			await connection.query(`create schema ${SCHEMA}`);
		},
	});
}
