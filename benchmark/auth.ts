/**
 * API parity: `better-drizzle/auth` against Better Auth's official Drizzle
 * adapter (`@better-auth/drizzle-adapter/relations-v2`) on the hot auth calls.
 *
 * Both adapters run on their own in-memory SQLite database with the same
 * schema, relations, and seed, receive the same Better Auth options, and are
 * called through Better Auth's adapter factory (`DBAdapter`), so each side
 * includes the same input/output transforms. Results are compared before
 * timing.
 */
import { Database } from 'bun:sqlite';
import { deepStrictEqual } from 'node:assert';

import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import type { BetterAuthOptions } from 'better-auth';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { bench, do_not_optimize, group, run, summary } from 'mitata';

import { better } from '../src';
import { adapter } from '../src/plugins/auth';

const user = sqliteTable('user', {
	id: text().primaryKey(),
	name: text().notNull(),
	email: text().notNull().unique(),
	emailVerified: integer({ mode: 'boolean' }).notNull().default(false),
	image: text(),
	createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
});

const session = sqliteTable(
	'session',
	{
		id: text().primaryKey(),
		expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
		token: text().notNull().unique(),
		ipAddress: text(),
		userAgent: text(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [index('session_userId_idx').on(table.userId)],
);

const relations = defineRelations({ session, user }, (r) => ({
	session: { user: r.one.user({ from: r.session.userId, to: r.user.id }) },
	user: { sessions: r.many.session() },
}));

const DDL = `
create table user (id text primary key, name text not null, email text not null unique, emailVerified integer not null default 0, image text, createdAt integer not null, updatedAt integer not null);
create table session (id text primary key, expiresAt integer not null, token text not null unique, ipAddress text, userAgent text, userId text not null references user(id) on delete cascade, createdAt integer not null, updatedAt integer not null);
create index session_userId_idx on session (userId);
`;

const USERS = 1_000;
const NOW = Date.UTC(2030, 0, 1);
const options: BetterAuthOptions = {
	advanced: { database: { joins: true } },
};

const createDatabase = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(DDL);
	sqlite.transaction(() => {
		const insertUser = sqlite.prepare(
			'insert into user (id, name, email, emailVerified, createdAt, updatedAt) values (?, ?, ?, 1, ?, ?)',
		);
		const insertSession = sqlite.prepare(
			'insert into session (id, expiresAt, token, userId, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?)',
		);
		for (let id = 1; id <= USERS; id++) {
			insertUser.run(
				`user-${id}`,
				`User ${id}`,
				`user-${id}@example.com`,
				NOW,
				NOW,
			);
			insertSession.run(
				`session-${id}`,
				NOW + 86_400_000,
				`token-${id}`,
				`user-${id}`,
				NOW,
				NOW,
			);
		}
	})();
	return drizzle({ client: sqlite, relations });
};

const sides = [
	{
		name: 'drizzle-adapter',
		adapter: drizzleAdapter(createDatabase(), { provider: 'sqlite' })(
			options,
		),
	},
	{
		name: 'better-drizzle/auth',
		adapter: adapter(better(createDatabase()), { transaction: false })(
			options,
		),
	},
];

type Side = (typeof sides)[number]['adapter'];

let created = 0;
const scenarios: {
	name: string;
	run(side: Side, iteration: number): Promise<unknown>;
	/** Masks values generated per call before comparing both sides. */
	mask?: (result: unknown) => unknown;
}[] = [
	{
		name: 'findOne session + user join',
		run: (side, iteration) =>
			side.findOne({
				join: { user: true },
				model: 'session',
				where: [
					{
						field: 'token',
						value: `token-${(iteration % USERS) + 1}`,
					},
				],
			}),
	},
	{
		name: 'create session',
		mask: (result) => ({ ...(result as object), id: '<id>' }),
		run: (side, iteration) =>
			side.create({
				data: {
					createdAt: new Date(NOW),
					expiresAt: new Date(NOW + 86_400_000),
					token: `created-${iteration}-${created++}`,
					updatedAt: new Date(NOW),
					userId: `user-${(iteration % USERS) + 1}`,
				},
				model: 'session',
			}),
	},
	{
		name: 'update session',
		run: (side, iteration) =>
			side.update({
				model: 'session',
				update: { expiresAt: new Date(NOW + 172_800_000) },
				where: [
					{
						field: 'token',
						value: `token-${(iteration % USERS) + 1}`,
					},
				],
			}),
	},
	{
		name: 'deleteMany expired sessions',
		run: (side) =>
			side.deleteMany({
				model: 'session',
				where: [
					{
						field: 'expiresAt',
						operator: 'lt',
						value: new Date(NOW),
					},
				],
			}),
	},
];

for (const scenario of scenarios) {
	const [expected, actual] = await Promise.all(
		sides.map(async ({ adapter }) => {
			const result = await scenario.run(adapter, 0);
			return scenario.mask ? scenario.mask(result) : result;
		}),
	);
	if (scenario.name.startsWith('create')) {
		const { token: _left, ...left } = expected as Record<string, unknown>;
		const { token: _right, ...right } = actual as Record<string, unknown>;
		deepStrictEqual(right, left, scenario.name);
	} else deepStrictEqual(actual, expected, scenario.name);
}
console.log(`Verified ${scenarios.length} auth scenarios.`);

if (!process.env.BENCH_VERIFY_ONLY) {
	for (const scenario of scenarios)
		group(scenario.name, () => {
			summary(() => {
				for (const side of sides) {
					let iteration = 0;
					bench(side.name, async () =>
						do_not_optimize(
							await scenario.run(side.adapter, iteration++),
						),
					);
				}
			});
		});
	await run();
}
