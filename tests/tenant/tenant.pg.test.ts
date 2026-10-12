import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { defineRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { Client } from 'pg';

import { better, param } from '../../src';
import { type TenantOptions, tenant } from '../../src/plugins/tenant';
import {
	LEAK_OPTIONS,
	LEAK_SEED,
	LEAK_TABLES,
	type LeakClients,
	runLeakSuite,
} from './leak-suite';

const projects = pgTable('better_drizzle_tenant_projects', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

const plans = pgTable('better_drizzle_tenant_plans', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const relations = defineRelations({ plans, projects });

const DATABASE_URL = process.env.DATABASE_URL;
const ROLE = 'better_drizzle_tenant_app';

// node-postgres raw calls return the driver result.
const rowsOf = (result: unknown) => (result as { rows: unknown[] }).rows;

const ids = (rows: readonly { id: unknown }[]) =>
	rows.map((row) => Number(row.id)).sort();

describe.skipIf(!DATABASE_URL)('tenant RLS (PostgreSQL)', () => {
	let admin: Client;
	let app: Client;

	// The app connection runs as a non-superuser role, so the policy applies.
	const createDb = (
		options: Partial<TenantOptions> = {},
		queries?: string[],
	) =>
		better(
			drizzle({
				client: app,
				logger: queries
					? { logQuery: (query) => queries.push(query) }
					: false,
				relations,
			}),
			{
				plugins: [
					tenant({
						columns: 'organizationId',
						global: ['plans'],
						raw: 'set-local',
						rls: true,
						...options,
					} as { columns: 'organizationId'; global: ['plans'] }),
				],
			},
		);

	const sqlRows = async (query: string) => (await admin.query(query)).rows;

	beforeAll(async () => {
		admin = new Client({ connectionString: DATABASE_URL });
		await admin.connect();
		await admin.query(`
			drop table if exists better_drizzle_tenant_projects;
			drop table if exists better_drizzle_tenant_plans;
			create table better_drizzle_tenant_projects (
				id integer primary key,
				name text not null,
				organization_id text not null
			);
			create table better_drizzle_tenant_plans (
				id integer primary key,
				name text not null
			);
			insert into better_drizzle_tenant_projects values
				(1, 'a-1', 'a'), (2, 'a-2', 'a'), (3, 'b-1', 'b');
			insert into better_drizzle_tenant_plans values (1, 'free');
			do $$ begin
				if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
					create role ${ROLE} nologin;
				end if;
			end $$;
			grant usage on schema public to ${ROLE};
			grant select, insert, update, delete
				on better_drizzle_tenant_projects, better_drizzle_tenant_plans
				to ${ROLE};
			alter table better_drizzle_tenant_projects enable row level security;
			alter table better_drizzle_tenant_projects force row level security;
			create policy tenant_isolation on better_drizzle_tenant_projects
				using (organization_id = nullif(current_setting('app.organization_id', true), ''))
				with check (organization_id = nullif(current_setting('app.organization_id', true), ''));
		`);
		const rolsuper = await sqlRows(
			`select rolsuper from pg_roles where rolname = '${ROLE}'`,
		);
		expect(rolsuper).toEqual([{ rolsuper: false }]);

		app = new Client({ connectionString: DATABASE_URL });
		await app.connect();
		await app.query(`set role ${ROLE}`);
	});

	afterAll(async () => {
		await app?.end();
		await admin?.query(`
			drop table if exists better_drizzle_tenant_projects;
			drop table if exists better_drizzle_tenant_plans;
		`);
		await admin?.end();
	});

	test('the policy hides every row without the setting', async () => {
		const db = createDb({ raw: 'allow' });
		expect(
			rowsOf(
				await db
					.$withoutTenant({ reason: 'probe' })
					.$raw(sql`select id from better_drizzle_tenant_projects`),
			),
		).toEqual([]);
	});

	test('TEN-35: scoped reads and writes run with the setting applied', async () => {
		const db = createDb();
		const scoped = db.$tenant({ organizationId: 'a' });

		expect(ids(await scoped.projects.findMany())).toEqual([1, 2]);
		expect(await scoped.projects.count()).toBe(2);
		const created = await scoped.projects.create({
			data: { id: 4, name: 'a-3' },
		});
		expect(created.organizationId).toBe('a');
		expect(
			await scoped.projects.updateMany({
				data: { name: 'renamed' },
				where: { id: { in: [1, 3] } },
			}),
		).toMatchObject({ count: 1 });
		expect(
			await sqlRows(
				'select id, name, organization_id from better_drizzle_tenant_projects order by id',
			),
		).toEqual([
			{ id: 1, name: 'renamed', organization_id: 'a' },
			{ id: 2, name: 'a-2', organization_id: 'a' },
			{ id: 3, name: 'b-1', organization_id: 'b' },
			{ id: 4, name: 'a-3', organization_id: 'a' },
		]);
		await admin.query(
			"delete from better_drizzle_tenant_projects where id = 4; update better_drizzle_tenant_projects set name = 'a-1' where id = 1",
		);
	});

	test('TEN-35: prepared reads and explain run with the setting applied', async () => {
		const queries: string[] = [];
		const scoped = createDb({}, queries).$tenant({ organizationId: 'b' });

		const statement = scoped.projects
			.findMany({ where: { name: param('name') } })
			.prepare();
		expect(ids(await statement.execute({ name: 'b-1' }))).toEqual([3]);
		expect(await statement.execute({ name: 'a-1' })).toEqual([]);

		queries.length = 0;
		await scoped.projects.findMany().explain({ analyze: true });
		const at = queries.findIndex((query) => /^explain/i.test(query));
		expect(at).toBeGreaterThan(0);
		expect(queries[at - 1]).toContain('set_config');

		queries.length = 0;
		await statement.explain({ name: 'b-1' });
		const preparedAt = queries.findIndex((query) =>
			/^explain/i.test(query),
		);
		expect(preparedAt).toBeGreaterThan(0);
		expect(queries[preparedAt - 1]).toContain('set_config');
	});

	test('TEN-36: the setting defaults to app.<db column> and honors rls.settings', async () => {
		const read = async (db: ReturnType<typeof createDb>, setting: string) =>
			rowsOf(
				await db
					.$tenant({ organizationId: 'a' })
					.$raw(
						sql`select current_setting(${setting}, true) as value`,
					),
			);

		expect(await read(createDb(), 'app.organization_id')).toEqual([
			{ value: 'a' },
		]);
		const custom = createDb({
			rls: { settings: { organizationId: 'tenant.org' } },
		});
		expect(await read(custom, 'tenant.org')).toEqual([{ value: 'a' }]);
	});

	test('RLS rejects duplicate and empty setting names', () => {
		for (const settings of [
			{ organizationId: 'app.shared', workspaceId: 'app.shared' },
			{ organizationId: '' },
			{ organizationId: '   ' },
			{ unknownColumn: 'app.unknown' },
		]) {
			let error: { code?: string } | undefined;
			try {
				createDb({
					columns: ['organizationId', 'workspaceId'],
					rls: { settings },
				});
			} catch (caught) {
				error = caught as { code?: string };
			}
			expect(error?.code).toBe('INVALID_ARGS');
		}
	});

	test('TEN-37: an explicit transaction sets the settings once', async () => {
		const queries: string[] = [];
		const scoped = createDb({}, queries).$tenant({ organizationId: 'a' });

		const rows = await scoped.transaction(async (tx) => {
			await tx.projects.findMany();
			await tx.projects.count();
			return rowsOf(
				await tx.$raw(
					sql`select id from better_drizzle_tenant_projects order by id`,
				),
			);
		});
		expect(ids(rows as { id: number }[])).toEqual([1, 2]);
		expect(
			queries.filter((query) => query.includes('set_config')),
		).toHaveLength(1);
	});

	test('RLS settings are cleared when a transaction client bypasses the tenant', async () => {
		const scoped = createDb().$tenant({ organizationId: 'a' });
		await scoped.transaction(async (tx) => {
			expect(ids(await tx.projects.findMany())).toEqual([1, 2]);
			expect(
				ids(
					await tx
						.$withoutTenant({ reason: 'audit' })
						.projects.findMany(),
				),
			).toEqual([]);
			expect(ids(await tx.projects.findMany())).toEqual([1, 2]);
			expect(ids(await tx.projects.$withoutPlugins().findMany())).toEqual(
				[],
			);
			expect(ids(await tx.projects.findMany())).toEqual([1, 2]);
		});
	});

	test('raw: allow clears an earlier tenant setting in the same transaction', async () => {
		const scoped = createDb({ raw: 'allow' }).$tenant({
			organizationId: 'a',
		});
		await scoped.transaction(async (tx) => {
			expect(ids(await tx.projects.findMany())).toEqual([1, 2]);
			const bypass = tx.$withoutTenant({ reason: 'raw audit' });
			expect(
				rowsOf(
					await bypass.$raw(
						sql`select id from better_drizzle_tenant_projects`,
					),
				),
			).toEqual([]);
		});
	});

	test('parallel sibling raw reads keep their own RLS setting', async () => {
		const queryClient = app as unknown as {
			query: (...args: unknown[]) => Promise<unknown>;
		};
		const originalQuery = queryClient.query;
		let reachedA = () => {};
		let reachedB = () => {};
		let releaseA = () => {};
		const aApplied = new Promise<void>((resolve) => {
			reachedA = resolve;
		});
		const bApplied = new Promise<void>((resolve) => {
			reachedB = resolve;
		});
		const aHeld = new Promise<void>((resolve) => {
			releaseA = resolve;
		});
		queryClient.query = async (...args) => {
			const result = await originalQuery.apply(app, args);
			const config = args[0] as { text?: string };
			const params = args[1] as unknown[] | undefined;
			if (config?.text?.includes('set_config') && params?.[1] === 'a') {
				reachedA();
				await aHeld;
			}
			if (config?.text?.includes('set_config') && params?.[1] === 'b')
				reachedB();
			return result;
		};

		try {
			const db = createDb();
			await db.transaction(async (tx) => {
				const tenantA = tx.$tenant({ organizationId: 'a' });
				const tenantB = tx.$tenant({ organizationId: 'b' });
				const query = sql`select id from better_drizzle_tenant_projects order by id`;
				const pendingA = tenantA.$raw(query);
				await aApplied;
				const pendingB = tenantB.$raw(query);
				let timeout: ReturnType<typeof setTimeout> | undefined;
				// An unserialized B reaches set_config while A is paused. With
				// serialization, B waits for A, so release A after a bounded wait.
				await Promise.race([
					bApplied,
					new Promise<void>((resolve) => {
						timeout = setTimeout(resolve, 500);
					}),
				]);
				if (timeout) clearTimeout(timeout);
				releaseA();
				const rowsA = rowsOf(await pendingA);
				const rowsB = rowsOf(await pendingB);
				expect(ids(rowsB as { id: number }[])).toEqual([3]);
				expect(ids(rowsA as { id: number }[])).toEqual([1, 2]);
			});
		} finally {
			releaseA();
			queryClient.query = originalQuery;
		}
	});

	test('cleared RLS settings do not expose rows with an empty tenant ID', async () => {
		await admin.query(
			"insert into better_drizzle_tenant_projects values (99, 'empty tenant', '')",
		);
		try {
			const scoped = createDb().$tenant({ organizationId: 'a' });
			await scoped.transaction(async (tx) => {
				await tx.projects.findMany();
				expect(
					ids(
						await tx
							.$withoutTenant({ reason: 'empty tenant audit' })
							.projects.findMany(),
					),
				).toEqual([]);
			});
		} finally {
			await admin.query(
				'delete from better_drizzle_tenant_projects where id = 99',
			);
		}
	});

	test('RLS rejects an empty tenant value', () => {
		const db = createDb();
		expect(() => db.$tenant({ organizationId: '' })).toThrow();
	});

	test('RLS settings are cleared for columns omitted by a sibling scope', async () => {
		const db = createDb({
			columns: ['organizationId', 'workspaceId'],
		});
		await db.transaction(async (tx) => {
			await tx
				.$tenant({
					organizationId: 'a',
					workspaceId: 'workspace-a',
				} as never)
				.projects.findMany();
			await tx.$tenant({ organizationId: 'a' }).projects.findMany();
			const setting = rowsOf(
				await tx
					.$tenant({ organizationId: 'a' })
					.$raw(
						sql`select current_setting('app.workspaceId', true) as value`,
					),
			);
			expect(setting).toEqual([{ value: '' }]);
		});
	});

	test('prepared reads apply a bypass transition inside a transaction', async () => {
		const scoped = createDb().$tenant({ organizationId: 'a' });
		await scoped.transaction(async (tx) => {
			expect(ids(await tx.projects.findMany())).toEqual([1, 2]);
			const bypass = tx.$withoutTenant({ reason: 'prepared audit' });
			const statement = bypass.projects.findMany().prepare();
			expect(ids(await statement.execute({}))).toEqual([]);
		});
	});

	test('prepared explain applies a bypass transition inside a transaction', async () => {
		const queries: string[] = [];
		const scoped = createDb({}, queries).$tenant({ organizationId: 'a' });
		await scoped.transaction(async (tx) => {
			await tx.projects.findMany();
			queries.length = 0;
			const bypass = tx.$withoutTenant({ reason: 'explain audit' });
			await bypass.projects.findMany().prepare().explain({});
			expect(queries.some((query) => query.includes('set_config'))).toBe(
				true,
			);
		});
	});

	test("TEN-38: `raw: 'set-local'` runs raw SQL inside the RLS transaction", async () => {
		const scoped = createDb().$tenant({ organizationId: 'b' });

		expect(
			rowsOf(
				await scoped.$raw(
					sql`select id from better_drizzle_tenant_projects order by id`,
				),
			),
		).toEqual([{ id: 3 }]);
		expect(
			await scoped.$executeRaw(
				sql`update better_drizzle_tenant_projects set name = name`,
			),
		).toEqual({ rowsAffected: 1 });
	});

	test('rls with raw: deny keeps raw denied and covers core queries', async () => {
		const scoped = createDb({ raw: 'deny' }).$tenant({
			organizationId: 'a',
		});

		await expect(
			Promise.resolve(scoped.$raw(sql`select 1`)),
		).rejects.toMatchObject({ code: 'TENANT_RAW_DENIED' });
		expect(ids(await scoped.projects.findMany())).toEqual([1, 2]);
		expect(ids(await scoped.plans.findMany())).toEqual([1]);
	});
});

const leakProjects = pgTable('bd_tl_projects', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
	slug: text('slug').notNull().unique(),
});

const leakTasks = pgTable('bd_tl_tasks', {
	id: integer('id').primaryKey(),
	organizationId: text('organization_id').notNull(),
	projectId: integer('project_id').notNull(),
	title: text('title').notNull(),
});

const leakMembers = pgTable('bd_tl_members', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

const leakProjectMembers = pgTable('bd_tl_project_members', {
	memberId: integer('member_id').notNull(),
	projectId: integer('project_id').notNull(),
});

const leakLabels = pgTable('bd_tl_labels', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

const leakProjectLabels = pgTable('bd_tl_project_labels', {
	labelId: integer('label_id').notNull(),
	organizationId: text('organization_id'),
	projectId: integer('project_id').notNull(),
});

const leakSchema = {
	boards: pgTable('bd_tl_boards', {
		id: integer('id').primaryKey(),
		name: text('name').notNull(),
		organizationId: text('organization_id').notNull(),
		workspaceId: integer('workspace_id').notNull(),
	}),
	labels: leakLabels,
	members: leakMembers,
	plans: pgTable('bd_tl_plans', {
		id: integer('id').primaryKey(),
		name: text('name').notNull(),
	}),
	projectLabels: leakProjectLabels,
	projectMembers: leakProjectMembers,
	projects: leakProjects,
	tasks: leakTasks,
	templates: pgTable('bd_tl_templates', {
		id: integer('id').primaryKey(),
		name: text('name').notNull(),
		organizationId: text('organization_id'),
		projectId: integer('project_id'),
	}),
};

const leakRelations = defineRelations(leakSchema, (r) => ({
	members: {
		projects: r.many.projects({
			from: r.members.id.through(r.projectMembers.memberId),
			to: r.projects.id.through(r.projectMembers.projectId),
		}),
	},
	projects: {
		labels: r.many.labels({
			from: r.projects.id.through(r.projectLabels.projectId),
			to: r.labels.id.through(r.projectLabels.labelId),
		}),
		members: r.many.members({
			from: r.projects.id.through(r.projectMembers.projectId),
			to: r.members.id.through(r.projectMembers.memberId),
		}),
		tasks: r.many.tasks({ from: r.projects.id, to: r.tasks.projectId }),
		templates: r.many.templates({
			from: r.projects.id,
			to: r.templates.projectId,
		}),
	},
	tasks: {
		project: r.one.projects({ from: r.tasks.projectId, to: r.projects.id }),
	},
}));

describe.skipIf(!DATABASE_URL)('tenant isolation (PostgreSQL)', () => {
	let client: Client;
	let clients: LeakClients;

	beforeAll(async () => {
		client = new Client({ connectionString: DATABASE_URL });
		await client.connect();
		await client.query(`
			drop table if exists ${LEAK_TABLES.join(', ')};
			create table bd_tl_plans (id integer primary key, name text not null);
			create table bd_tl_projects (id integer primary key, name text not null, slug text not null unique, organization_id text not null);
			create table bd_tl_tasks (id integer primary key, title text not null, organization_id text not null, project_id integer not null);
			create table bd_tl_members (id integer primary key, name text not null, organization_id text not null);
			create table bd_tl_project_members (project_id integer not null, member_id integer not null);
			create table bd_tl_boards (id integer primary key, name text not null, organization_id text not null, workspace_id integer not null);
			create table bd_tl_templates (id integer primary key, name text not null, organization_id text, project_id integer);
			create table bd_tl_labels (id integer primary key, name text not null, organization_id text not null);
			create table bd_tl_project_labels (project_id integer not null, label_id integer not null, organization_id text);
		`);
		const raw = drizzle({ client, relations: leakRelations });
		clients = {
			db: better(raw, { plugins: [tenant(LEAK_OPTIONS)] }),
			raw,
		} as unknown as LeakClients;
	});

	afterAll(async () => {
		await client?.query(`drop table if exists ${LEAK_TABLES.join(', ')}`);
		await client?.end();
	});

	runLeakSuite({
		clients: () => clients,
		dialect: 'postgresql',
		query: async (text) => (await client.query(text)).rows,
		reset: async () => {
			await client.query(
				`delete from ${LEAK_TABLES.join('; delete from ')}; ${LEAK_SEED.join('; ')}`,
			);
		},
	});
});
