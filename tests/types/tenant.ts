// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import type { Database } from 'bun:sqlite';

import { better } from 'better-drizzle';
import { tenant } from 'better-drizzle/tenant';
import { defineRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const organizations = sqliteTable('organizations', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
});
const projects = sqliteTable('projects', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
	workspaceId: integer('workspace_id').notNull(),
});
// `organizationId` is numeric here: `$tenant` values are the union.
const invoices = sqliteTable('invoices', {
	id: integer('id').primaryKey(),
	organizationId: integer('organization_id').notNull(),
	total: integer('total').notNull(),
});
// Global despite its `organizationId`: never stamped, so the column stays required.
const plans = sqliteTable('plans', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

// Scoped, with a database name that differs from its table key.
const tasks = sqliteTable('project_tasks', {
	id: integer('id').primaryKey(),
	organizationId: text('organization_id').notNull(),
});

declare const client: Database;

const raw = drizzle({
	client,
	relations: defineRelations({
		invoices,
		organizations,
		plans,
		projects,
		tasks,
	}),
});

const db = better(raw, {
	plugins: [
		tenant({
			columns: ['organizationId', 'workspaceId'],
			global: ['organizations', 'plans'],
		}),
	],
});

// Values are typed from the insert types; partial objects are allowed.
const scoped = db.$tenant({ organizationId: 'org-a' });
db.$tenant({ organizationId: 1 });
db.$tenant({ organizationId: 'org-a', workspaceId: 1 });
scoped.$tenant({ workspaceId: 2 }).projects.findMany();
// @ts-expect-error `workspaceId` is a number column.
db.$tenant({ workspaceId: 'w' });
// @ts-expect-error unknown keys are rejected.
db.$tenant({ organizationId: 'org-a', tenantId: 'x' });
// @ts-expect-error `$tenant` takes an object.
db.$tenant('org-a');
const values: Readonly<{
	organizationId?: string | number;
	workspaceId?: number;
}> = scoped.$tenant.values;

const extended = db.extends({ helper: () => 1 });
extended.$tenant({ organizationId: 'org-a' }).helper();
extended.$withoutTenant({ reason: 'audit' }).helper();
extended.$tenant({ organizationId: 'org-a' }).transaction(async (tx) => {
	tx.helper();
});
const detachedTenant = db.$tenant;
detachedTenant({ organizationId: 'org-a' }).projects.findMany();
const detachedBypass = db.$withoutTenant;
detachedBypass({ reason: 'audit' }).projects.findMany();

// `reason` is required.
db.$withoutTenant({ reason: 'nightly job' }).projects.findMany();
// @ts-expect-error `reason` is required.
db.$withoutTenant({});
// @ts-expect-error `$withoutTenant` takes options.
db.$withoutTenant();

// Tenant columns are optional on create; other columns stay required.
scoped.projects.create({ data: { name: 'P' } });
scoped.projects.create({
	data: { name: 'P', organizationId: 'org-a', workspaceId: 1 },
});
scoped.projects.createMany({ data: [{ name: 'P' }] });
scoped.projects.upsert({
	create: { name: 'P' },
	update: { name: 'Q' },
	where: { id: 1 },
});
scoped.invoices.create({ data: { total: 1 } });
// @ts-expect-error `name` is still required.
scoped.projects.create({ data: {} });
db.plans.create({ data: { name: 'Free', organizationId: 'org-a' } });
// @ts-expect-error global models keep their tenant columns required.
db.plans.create({ data: { name: 'Free' } });

// Per-model overrides: a model scoped by a subset, or opted out.
const overridden = better(raw, {
	plugins: [
		tenant({
			columns: 'organizationId',
			global: ['organizations', 'plans'],
			models: {
				invoices: false,
				projects: { columns: ['organizationId'], nullable: true },
			},
		}),
	],
});
overridden.projects.create({ data: { name: 'P', workspaceId: 1 } });
// @ts-expect-error `invoices` opted out, so `organizationId` is required.
overridden.invoices.create({ data: { total: 1 } });
// @ts-expect-error a string `columns` only accepts that column.
overridden.$tenant({ workspaceId: 1 });

tenant({
	columns: ['organizationId'],
	// @ts-expect-error overrides only list configured columns.
	models: { projects: ['workspaceId'] },
});

// Raw opt-in is typed through `RawOptionsExtensions`.
scoped.$raw(sql`select 1`, { tenant: 'trusted' });
// @ts-expect-error the opt-in value is `'trusted'`.
scoped.$raw(sql`select 1`, { tenant: 'yes' });

// `strict` hides scoped models on the root client; global models stay.
const strict = better(raw, {
	plugins: [
		tenant({
			columns: ['organizationId', 'workspaceId'],
			global: ['organizations', 'plans'],
			models: { invoices: false },
			strict: true,
		}),
	],
});
strict.plans.findMany();
strict.organizations.findMany();
strict.invoices.findMany();
// @ts-expect-error scoped models are hidden on the strict root client.
strict.projects.findMany();
// @ts-expect-error hidden on `$withContext()` clients too.
strict.$withContext({}).projects.findMany();
strict.transaction(async (tx) => {
	tx.plans.findMany();
	// @ts-expect-error hidden on root transaction clients too.
	tx.projects.findMany();
});
strict.$tenant({ organizationId: 'org-a' }).projects.findMany();
strict.$withoutTenant({ reason: 'migration' }).projects.findMany();
const strictExtended = strict.extends({ helper: () => 1 });
strictExtended.$tenant({ organizationId: 'org-a' }).helper();
strictExtended.$withoutTenant({ reason: 'migration' }).helper();
strictExtended.$tenant({ organizationId: 'org-a' }).projects.findMany();
// `repository(name)` follows the same rule, by table key or database name.
strict.repository('plans').findMany();
strict.repository('invoices').findMany();
// @ts-expect-error scoped models are hidden from `repository()` by key.
strict.repository('projects');
// @ts-expect-error and by database name.
strict.repository('project_tasks');
// @ts-expect-error the table key of a renamed table is hidden as well.
strict.repository('tasks');
strict.$withContext({}).repository('organizations').findMany();
strict.transaction(async (tx) => {
	tx.repository('plans').findMany();
	// @ts-expect-error hidden from transaction `repository()` too.
	tx.repository('projects');
});
strict.$tenant({ organizationId: 'org-a' }).repository('projects').findMany();
strict
	.$tenant({ organizationId: 'org-a' })
	.repository('project_tasks')
	.findMany();
strict
	.$withoutTenant({ reason: 'migration' })
	.repository('projects')
	.findMany();
db.repository('projects').findMany();
// Without `strict`, scoped models stay on the root client type.
db.projects.findMany();

tenant({
	columns: 'organizationId',
	// @ts-expect-error `strict` requires `missing: 'throw'`.
	missing: 'allow',
	strict: true,
});
tenant({ columns: 'organizationId', missing: 'allow' });

export { values };
