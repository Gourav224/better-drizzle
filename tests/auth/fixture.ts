import { Database } from 'bun:sqlite';

import { betterAuth } from 'better-auth';
import { type AnyPlugin, better } from 'better-drizzle';
import { type AuthAdapterOptions, adapter } from 'better-drizzle/auth';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamps = {
	createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
};

export const user = sqliteTable('user', {
	id: text().primaryKey(),
	name: text().notNull(),
	email: text().notNull().unique(),
	emailVerified: integer({ mode: 'boolean' }).notNull().default(false),
	image: text(),
	deletedAt: integer({ mode: 'timestamp_ms' }),
	organizationId: text(),
	metadata: text({ mode: 'json' }),
	...timestamps,
});

export const session = sqliteTable(
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
		...timestamps,
	},
	(table) => [index('session_userId_idx').on(table.userId)],
);

export const account = sqliteTable('account', {
	id: text().primaryKey(),
	accountId: text().notNull(),
	providerId: text().notNull(),
	userId: text()
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text(),
	refreshToken: text(),
	idToken: text(),
	accessTokenExpiresAt: integer({ mode: 'timestamp_ms' }),
	refreshTokenExpiresAt: integer({ mode: 'timestamp_ms' }),
	scope: text(),
	password: text(),
	...timestamps,
});

export const verification = sqliteTable('verification', {
	id: text().primaryKey(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
	...timestamps,
});

/** An app table scoped by the tenant plugin. */
export const project = sqliteTable('project', {
	id: text().primaryKey(),
	name: text().notNull(),
	organizationId: text().notNull(),
});

const DDL = `
create table user (id text primary key, name text not null, email text not null unique, emailVerified integer not null default 0, image text, deletedAt integer, organizationId text, metadata text, createdAt integer not null, updatedAt integer not null);
create table session (id text primary key, expiresAt integer not null, token text not null unique, ipAddress text, userAgent text, userId text not null references user(id) on delete cascade, createdAt integer not null, updatedAt integer not null);
create index session_userId_idx on session (userId);
create table account (id text primary key, accountId text not null, providerId text not null, userId text not null references user(id) on delete cascade, accessToken text, refreshToken text, idToken text, accessTokenExpiresAt integer, refreshTokenExpiresAt integer, scope text, password text, createdAt integer not null, updatedAt integer not null);
create table verification (id text primary key, identifier text not null, value text not null, expiresAt integer not null, createdAt integer not null, updatedAt integer not null);
create table project (id text primary key, name text not null, organizationId text not null);
`;

export const schema = { account, project, session, user, verification };

export const relations = defineRelations(schema, (r) => ({
	account: { user: r.one.user({ from: r.account.userId, to: r.user.id }) },
	session: { user: r.one.user({ from: r.session.userId, to: r.user.id }) },
	user: {
		accounts: r.many.account(),
		sessions: r.many.session(),
	},
}));

type Options = {
	adapter?: AuthAdapterOptions;
	auth?: Partial<Parameters<typeof betterAuth>[0]>;
	plugins?: readonly AnyPlugin[];
	relations?: object;
};

export const createAuth = ({
	adapter: adapterOptions,
	auth: authOptions,
	plugins = [],
	relations: customRelations = relations,
}: Options = {}) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(DDL);
	const queries: string[] = [];
	const db = better(
		drizzle({
			client: sqlite,
			logger: { logQuery: (query) => queries.push(query) },
			relations: customRelations as typeof relations,
		}),
		{ plugins },
	);
	const auth = betterAuth({
		database: adapter(db, adapterOptions),
		emailAndPassword: { enabled: true },
		baseURL: 'http://localhost:3000',
		secret: 'better-drizzle-auth-test-secret-0123456789',
		...authOptions,
	});
	return { auth, db, queries, sqlite };
};

/** Signs up and returns the session cookie. */
export const signUp = async (
	auth: ReturnType<typeof createAuth>['auth'],
	email = 'ada@example.com',
) => {
	const response = await auth.api.signUpEmail({
		asResponse: true,
		body: { email, name: 'Ada', password: 'correct horse battery' },
	});
	return {
		cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
		response,
	};
};
