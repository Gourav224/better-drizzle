import type * as bunTest from 'bun:test';

import type * as better from 'better-drizzle';
import type * as ata from 'better-drizzle/ata';
import type * as cache from 'better-drizzle/cache';
import type { CacheStore } from 'better-drizzle/cache';
import type * as rules from 'better-drizzle/rules';
import type * as softDelete from 'better-drizzle/soft-delete';
import type * as tenant from 'better-drizzle/tenant';
import type * as timestamps from 'better-drizzle/timestamps';
import type * as uuid from 'better-drizzle/uuid';
import type * as zod from 'better-drizzle/zod';
// Names the docs snippets use without importing them. A snippet that imports
// or declares the same name shadows these.
import type * as drizzle from 'drizzle-orm';
import type * as pg from 'drizzle-orm/node-postgres';

import type * as schemaModule from './schema';

type Client = typeof import('./db').client;
// Pages with their own schema may not define every table.
type Table<Name extends string> = Name extends keyof typeof schemaModule
	? (typeof schemaModule)[Name]
	: never;

declare global {
	const client: Client;
	const db: typeof import('./db').db;
	// A tenant-scoped client from an earlier snippet on the page.
	const scoped: Client;
	type Db = Client;
	const tx: Parameters<Parameters<Client['transaction']>[0]>[0];

	const users: Table<'users'>;
	const profiles: Table<'profiles'>;
	const posts: Table<'posts'>;
	const comments: Table<'comments'>;
	const tags: Table<'tags'>;
	const postTags: Table<'postTags'>;
	const groups: Table<'groups'>;
	const memberships: Table<'memberships'>;
	const accounts: Table<'accounts'>;
	const orders: Table<'orders'>;
	const jobs: Table<'jobs'>;
	const organizations: Table<'organizations'>;
	const projects: Table<'projects'>;
	const tasks: Table<'tasks'>;

	const and: typeof drizzle.and;
	const asc: typeof drizzle.asc;
	const count: typeof drizzle.count;
	const desc: typeof drizzle.desc;
	const eq: typeof drizzle.eq;
	const exists: typeof drizzle.exists;
	const gt: typeof drizzle.gt;
	const gte: typeof drizzle.gte;
	const ilike: typeof drizzle.ilike;
	const inArray: typeof drizzle.inArray;
	const isNotNull: typeof drizzle.isNotNull;
	const isNull: typeof drizzle.isNull;
	const like: typeof drizzle.like;
	const lt: typeof drizzle.lt;
	const lte: typeof drizzle.lte;
	const ne: typeof drizzle.ne;
	const not: typeof drizzle.not;
	const or: typeof drizzle.or;
	const sql: typeof drizzle.sql;

	const schema: typeof schemaModule;
	const relations: typeof import('./relations').relations;
	const drizzle: typeof pg.drizzle;
	const defineRelations: typeof drizzle.defineRelations;

	const better: typeof better.better;
	const definePlugin: typeof better.definePlugin;
	const getDatabaseErrorInfo: typeof better.getDatabaseErrorInfo;
	const param: typeof better.param;
	const BetterDrizzleError: typeof better.BetterDrizzleError;
	const BetterDrizzleErrorCode: typeof better.BetterDrizzleErrorCode;
	const isUniqueViolation: typeof better.isUniqueViolation;
	type BetterDrizzleClient<
		Schema extends better.AnySchema =
			typeof import('./relations').relations,
	> = better.BetterDrizzleClient<Schema>;
	type WhereArg<
		Schema extends better.AnySchema,
		Name extends better.BetterTableKey<Schema>,
	> = better.WhereArg<Schema, Name>;
	type BetterTableKey<Schema extends better.AnySchema> =
		better.BetterTableKey<Schema>;

	const ata: typeof ata.ata;
	const cache: typeof cache.cache;
	const rules: typeof rules.rules;
	const recommended: typeof rules.recommended;
	const safe: typeof rules.safe;
	const softDelete: typeof softDelete.softDelete;
	const tenant: typeof tenant.tenant;
	const timestamps: typeof timestamps.timestamps;
	const uuids: typeof uuid.uuids;
	const zod: typeof zod.zod;

	const describe: typeof bunTest.describe;
	const expect: typeof bunTest.expect;
	const test: typeof bunTest.test;

	// Values a snippet takes from its surrounding code (request input, ids).
	// Framework app; route methods take type arguments (`app.get<{ Params }>`).
	const app: Record<string, <T = any>(...args: any[]) => any>;
	const connection: any;
	const ctx: any;
	const currentTenant: any;
	const currentUserId: any;
	const data: any;
	const email: any;
	const error: any;
	const id: any;
	const input: any;
	const inputs: any;
	const findUserByEmail: any;
	const fromId: any;
	const ids: any;
	const importedRows: any;
	const log: any;
	const logger: any;
	const name: any;
	const order: any;
	const organizationId: any;
	const pool: any;
	const postId: any;
	const previousCursor: any;
	// Comparison pages show the equivalent Prisma call.
	const prisma: any;
	const query: any;
	const redis: any;
	const req: any;
	const request: any;
	const requestId: any;
	const rows: any;
	const session: any;
	const store: CacheStore;
	const userId: any;
	const metrics: any;
	const observability: any;
	const options: any;
	const reply: any;
	const tenantId: any;
	const title: any;
	const toId: any;
	const cleanupTempFiles: (...args: any[]) => any;
	const notifySubscribers: (...args: any[]) => any;
	const rollbackAfter: (...args: any[]) => any;
	const sendReceipt: (...args: any[]) => any;
	const sendWelcomeEmail: (...args: any[]) => any;
}
