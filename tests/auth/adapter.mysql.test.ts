import { mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2';

import { runAdapterSuite } from './suite';

const MYSQL_URL = process.env.MYSQL_URL;
const DATABASE = 'better_drizzle_auth';

if (MYSQL_URL) {
	// Better Auth's tables live in their own database, so `user` and friends
	// do not collide with other suites sharing the server.
	const setup = createPool(MYSQL_URL).promise();
	await setup.query(`create database if not exists ${DATABASE}`);
	await setup.end();
	const url = new URL(MYSQL_URL);
	url.pathname = `/${DATABASE}`;
	// Better Auth's migrator (Kysely) needs the callback pool.
	const connection = createPool(url.toString());

	await runAdapterSuite({
		// Better Auth detects MySQL by `getConnection` and passes the object to
		// Kysely's MysqlDialect, which reads the pool from `pool`.
		connection: { getConnection: () => {}, pool: connection },
		dialect: 'mysql',
		// MySQL's default collation compares case-insensitively, so a
		// sensitive `eq` matches other cases unless the column uses a `_bin`
		// or `_cs` collation (the official Drizzle adapter behaves the same).
		disable: {
			'findOne - eq with mode sensitive (default) should not match different case': true,
		},
		drizzle: (relations) => drizzle({ client: connection, relations }),
		placeholder: {
			placeholder: mysqlTable('placeholder', {
				id: varchar({ length: 36 }),
			}),
		},
		reset: async () => {
			const [tables] = await connection
				.promise()
				.query(
					'select table_name as name from information_schema.tables where table_schema = ?',
					[DATABASE],
				);
			await connection.promise().query('set foreign_key_checks = 0');
			for (const { name } of tables as { name: string }[])
				await connection.promise().query(`drop table \`${name}\``);
			await connection.promise().query('set foreign_key_checks = 1');
		},
		skip: { uuid: true },
	});
}
