import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better, param } from '../../src';
import { tenant } from '../../src/plugins/tenant';

// Cross-tenant leak matrix shared by the SQLite, PostgreSQL, and MySQL runs.
// Rows of org `b` point at org `a` parents (and back) on purpose, so every
// relation path that forgets the scope returns a different answer.

export const LEAK_TABLES = [
	'bd_tl_plans',
	'bd_tl_projects',
	'bd_tl_tasks',
	'bd_tl_members',
	'bd_tl_project_members',
	'bd_tl_boards',
	'bd_tl_templates',
	'bd_tl_labels',
	'bd_tl_project_labels',
] as const;

export const LEAK_OPTIONS = {
	columns: ['organizationId', 'workspaceId'],
	global: ['plans'],
	models: {
		projectLabels: { columns: ['organizationId'], nullable: true },
		templates: { columns: ['organizationId'], nullable: true },
	},
} as const;

export const LEAK_SEED = [
	"insert into bd_tl_plans values (1, 'free')",
	"insert into bd_tl_projects values (1, 'a-p1', 'a-p1', 'a'), (2, 'a-p2', 'a-p2', 'a'), (3, 'b-p1', 'b-p1', 'b')",
	"insert into bd_tl_tasks values (1, 'a-t1', 'a', 1), (2, 'a-t2', 'a', 2), (3, 'b-t1', 'b', 3), (4, 'b-t2', 'b', 1), (5, 'a-t3', 'a', 3), (6, 'a-t4', 'a', 2), (7, 'b-t3', 'b', 1)",
	"insert into bd_tl_members values (1, 'a-m1', 'a'), (2, 'b-m1', 'b'), (3, 'a-m2', 'a')",
	'insert into bd_tl_project_members values (1, 1), (1, 2), (2, 1), (2, 3), (3, 1), (3, 2)',
	"insert into bd_tl_boards values (1, 'w1', 'a', 1), (2, 'w2', 'a', 2), (3, 'w3', 'b', 3)",
	// Template 3 is shared (`NULL` tenant) and linked to a tenant `a` project.
	"insert into bd_tl_templates values (1, 'a-tpl', 'a', 1), (2, 'b-tpl', 'b', null), (3, 'shared', null, 1)",
	"insert into bd_tl_labels values (1, 'a-l1', 'a'), (2, 'a-l2', 'a')",
	// Project 1 has one own label link and one shared (`NULL` tenant) link.
	"insert into bd_tl_project_labels values (1, 1, 'a'), (1, 2, null)",
];

const plans = sqliteTable('bd_tl_plans', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const projects = sqliteTable('bd_tl_projects', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
	slug: text('slug').notNull().unique(),
});

const tasks = sqliteTable('bd_tl_tasks', {
	id: integer('id').primaryKey(),
	organizationId: text('organization_id').notNull(),
	projectId: integer('project_id').notNull(),
	title: text('title').notNull(),
});

const members = sqliteTable('bd_tl_members', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

const projectMembers = sqliteTable('bd_tl_project_members', {
	memberId: integer('member_id').notNull(),
	projectId: integer('project_id').notNull(),
});

const boards = sqliteTable('bd_tl_boards', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
	workspaceId: integer('workspace_id').notNull(),
});

const templates = sqliteTable('bd_tl_templates', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id'),
	projectId: integer('project_id'),
});

const labels = sqliteTable('bd_tl_labels', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

const projectLabels = sqliteTable('bd_tl_project_labels', {
	labelId: integer('label_id').notNull(),
	organizationId: text('organization_id'),
	projectId: integer('project_id').notNull(),
});

const relations = defineRelations(
	{
		boards,
		labels,
		members,
		plans,
		projectLabels,
		projectMembers,
		projects,
		tasks,
		templates,
	},
	(r) => ({
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
			project: r.one.projects({
				from: r.tasks.projectId,
				to: r.projects.id,
			}),
		},
	}),
);

const SQLITE_DDL = `
CREATE TABLE bd_tl_plans (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE bd_tl_projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL);
CREATE TABLE bd_tl_tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, organization_id TEXT NOT NULL, project_id INTEGER NOT NULL);
CREATE TABLE bd_tl_members (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT NOT NULL);
CREATE TABLE bd_tl_project_members (project_id INTEGER NOT NULL, member_id INTEGER NOT NULL);
CREATE TABLE bd_tl_boards (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT NOT NULL, workspace_id INTEGER NOT NULL);
CREATE TABLE bd_tl_templates (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT, project_id INTEGER);
CREATE TABLE bd_tl_labels (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT NOT NULL);
CREATE TABLE bd_tl_project_labels (project_id INTEGER NOT NULL, label_id INTEGER NOT NULL, organization_id TEXT);
`;

const createSqliteLeakDb = (sqlite: Database) => {
	const raw = drizzle({ client: sqlite, relations });
	return { db: better(raw, { plugins: [tenant(LEAK_OPTIONS)] }), raw };
};

export type LeakClients = ReturnType<typeof createSqliteLeakDb>;

export type LeakHarness = {
	dialect: 'mysql' | 'postgresql' | 'sqlite';
	/** Clients built once the database is ready. */
	clients: () => LeakClients;
	/** Empties every table and runs `LEAK_SEED`. */
	reset: () => Promise<void>;
	query: (text: string) => Promise<Record<string, unknown>[]>;
};

/** SQLite harness: one in-memory database for the whole run. */
export const sqliteLeakHarness = (): LeakHarness => {
	const sqlite = new Database(':memory:');
	sqlite.exec(SQLITE_DDL);
	const clients = createSqliteLeakDb(sqlite);
	return {
		clients: () => clients,
		dialect: 'sqlite',
		query: async (text) => sqlite.query(text).all() as never,
		reset: async () => {
			for (const table of LEAK_TABLES)
				sqlite.exec(`delete from ${table}`);
			for (const statement of LEAK_SEED) sqlite.exec(statement);
		},
	};
};

const ids = (rows: readonly { id: unknown }[]) =>
	rows.map((row) => Number(row.id)).sort((left, right) => left - right);

const ordered = (rows: readonly { id: unknown }[]) =>
	rows.map((row) => Number(row.id));

const settle = (operation: unknown) => Promise.resolve(operation);

const MISS = 'Relation selector did not match a record.';

export const runLeakSuite = (harness: LeakHarness) => {
	const { dialect } = harness;
	const mysql = dialect === 'mysql';
	const scoped = () => harness.clients().db.$tenant({ organizationId: 'a' });
	const projectRows = () =>
		harness.query(
			'select id, name, organization_id from bd_tl_projects order by id',
		);
	const PROJECTS = [
		{ id: 1, name: 'a-p1', organization_id: 'a' },
		{ id: 2, name: 'a-p2', organization_id: 'a' },
		{ id: 3, name: 'b-p1', organization_id: 'b' },
	];
	const links = async () =>
		(
			await harness.query(
				'select project_id, member_id from bd_tl_project_members order by project_id, member_id',
			)
		).map((row) => [Number(row.project_id), Number(row.member_id)]);
	const LINKS = [
		[1, 1],
		[1, 2],
		[2, 1],
		[2, 3],
		[3, 1],
		[3, 2],
	];

	beforeEach(() => harness.reset());

	describe('reads', () => {
		test('SCOPE-01: find*, count, exists, and paginate see only the tenant', async () => {
			const a = scoped();

			expect(ids(await a.projects.findMany())).toEqual([1, 2]);
			expect(
				ids(
					await a.projects.findMany({
						where: { id: { in: [1, 3] } },
					}),
				),
			).toEqual([1]);
			expect(await a.projects.findFirst({ where: { id: 3 } })).toBeNull();
			expect(await a.projects.findOne({ where: { id: 3 } })).toBeNull();
			expect(
				await a.projects.findUnique({ where: { id: 3 } }),
			).toBeNull();
			expect(
				await a.projects.findUnique({ where: { slug: 'b-p1' } }),
			).toBeNull();
			expect(await a.projects.count()).toBe(2);
			expect(
				await a.projects.count({ where: { id: { in: [1, 3] } } }),
			).toBe(1);
			expect(await a.projects.exists({ where: { id: 3 } })).toBe(false);

			const {
				data,
				pagination: { pageCount, total },
			} = await a.projects.paginate({
				orderBy: { id: 'asc' },
				page: 1,
				perPage: 1,
			});
			expect(ordered(data)).toEqual([1]);
			expect({ pageCount, total }).toEqual({ pageCount: 2, total: 2 });
		});

		test('SCOPE-06: cursor pages and navigation flags ignore other tenants', async () => {
			const a = scoped();

			const last = await a.projects.cursor({
				after: { id: 1 },
				limit: 1,
				orderBy: { id: 'asc' },
			});
			expect(ordered(last.data)).toEqual([2]);
			expect(last.pagination.hasNext).toBe(false);

			const tasksPage = await a.tasks.cursor({
				after: { id: 2 },
				limit: 1,
				orderBy: { id: 'asc' },
			});
			expect(ordered(tasksPage.data)).toEqual([5]);
			expect(tasksPage.pagination).toMatchObject({
				hasNext: true,
				hasPrevious: true,
			});

			const first = await a.tasks.cursor({
				before: { id: 5 },
				limit: 5,
				orderBy: { id: 'asc' },
			});
			expect(ordered(first.data)).toEqual([1, 2]);
			expect(first.pagination.hasPrevious).toBe(false);
		});

		test('SCOPE-01: prepared reads stay scoped on every execution', async () => {
			const statement = scoped()
				.projects.findMany({ where: { name: param('name') } })
				.prepare();

			expect(ids(await statement.execute({ name: 'a-p1' }))).toEqual([1]);
			expect(await statement.execute({ name: 'b-p1' })).toEqual([]);

			const byTask = scoped()
				.projects.findMany({
					where: { tasks: { some: { title: param('title') } } },
				})
				.prepare();
			expect(ids(await byTask.execute({ title: 'a-t1' }))).toEqual([1]);
			expect(await byTask.execute({ title: 'b-t2' })).toEqual([]);
		});

		test('SCOPE-02: include and relation select load only tenant rows', async () => {
			const a = scoped();

			const withTasks = await a.projects.findMany({
				include: { tasks: { orderBy: { id: 'asc' } } },
				orderBy: { id: 'asc' },
			});
			expect(withTasks.map((row) => ordered(row.tasks))).toEqual([
				[1],
				[2, 6],
			]);

			const selected = await a.projects.findMany({
				orderBy: { id: 'asc' },
				select: { id: true, tasks: { select: { id: true } } },
			});
			expect(selected.map((row) => ids(row.tasks))).toEqual([
				[1],
				[2, 6],
			]);

			// Per-parent windows rank only tenant rows.
			const latest = await a.projects.findMany({
				include: { tasks: { orderBy: { id: 'desc' }, take: 1 } },
				orderBy: { id: 'asc' },
			});
			expect(latest.map((row) => ordered(row.tasks))).toEqual([[1], [6]]);

			const withProject = await a.tasks.findMany({
				include: { project: true },
				orderBy: { id: 'asc' },
			});
			expect(
				withProject.map((row) => [
					Number(row.id),
					row.project?.id ?? null,
				]),
			).toEqual([
				[1, 1],
				[2, 2],
				[5, null],
				[6, 2],
			]);

			const filtered = await a.tasks.findMany({
				include: { project: true },
				orderBy: { id: 'asc' },
				where: { project: { is: { name: 'a-p2' } } },
			});
			expect(ordered(filtered)).toEqual([2, 6]);
		});

		test('SCOPE-02: .through() relations scope the junction and the target', async () => {
			const a = scoped();

			const projectMembers = await a.projects.findMany({
				include: { members: { orderBy: { id: 'asc' } } },
				orderBy: { id: 'asc' },
			});
			expect(projectMembers.map((row) => ordered(row.members))).toEqual([
				[1],
				[1, 3],
			]);

			const latest = await a.projects.findMany({
				include: { members: { orderBy: { id: 'desc' }, take: 1 } },
				orderBy: { id: 'asc' },
			});
			expect(latest.map((row) => ordered(row.members))).toEqual([
				[1],
				[3],
			]);

			const memberProjects = await a.members.findMany({
				orderBy: { id: 'asc' },
				select: {
					id: true,
					projects: { orderBy: { id: 'asc' }, select: { id: true } },
				},
			});
			expect(
				memberProjects.map((row) => [
					Number(row.id),
					ordered(row.projects),
				]),
			).toEqual([
				[1, [1, 2]],
				[3, [2]],
			]);
		});

		test('SCOPE-03: relation filters ignore other tenants (EDGE-02, EDGE-03)', async () => {
			const a = scoped();
			const projectIds = async (where: object) =>
				ids(await a.projects.findMany({ where: where as never }));
			const taskIds = async (where: object) =>
				ids(await a.tasks.findMany({ where: where as never }));

			expect(
				await projectIds({
					tasks: { some: { id: { in: [3, 4, 7] } } },
				}),
			).toEqual([]);
			expect(
				await projectIds({
					tasks: { every: { title: { startsWith: 'a-' } } },
				}),
			).toEqual([1, 2]);
			expect(
				await projectIds({ tasks: { none: { id: { in: [4, 7] } } } }),
			).toEqual([1, 2]);
			expect(await projectIds({ members: { some: { id: 2 } } })).toEqual(
				[],
			);
			expect(await projectIds({ members: { none: { id: 2 } } })).toEqual([
				1, 2,
			]);
			expect(
				await projectIds({
					members: { every: { name: { startsWith: 'a-' } } },
				}),
			).toEqual([1, 2]);

			expect(
				await taskIds({ project: { is: { name: 'b-p1' } } }),
			).toEqual([]);
			expect(
				await taskIds({ project: { isNot: { name: 'a-p1' } } }),
			).toEqual([2, 5, 6]);
			expect(await taskIds({ project: { is: null } })).toEqual([5]);
			expect(await taskIds({ project: { isNot: null } })).toEqual([
				1, 2, 6,
			]);
		});

		test('SCOPE-04: include.count counts only tenant rows', async () => {
			const rows = await scoped().projects.findMany({
				include: { count: { select: { members: true, tasks: true } } },
				orderBy: { id: 'asc' },
			});

			expect(rows.map((row) => row.count)).toEqual([
				{ members: 1, tasks: 1 },
				{ members: 2, tasks: 2 },
			]);
		});

		test('SCOPE-05: relation sorts read only tenant rows', async () => {
			const a = scoped();

			expect(
				ordered(
					await a.projects.findMany({
						orderBy: [{ tasks: { count: 'desc' } }, { id: 'asc' }],
					}),
				),
			).toEqual([2, 1]);
			expect(
				ordered(
					await a.projects.findMany({
						orderBy: [
							{ members: { count: 'desc' } },
							{ id: 'asc' },
						],
					}),
				),
			).toEqual([2, 1]);
			expect(
				ordered(
					await a.tasks.findMany({
						orderBy: [
							{
								project: {
									name: { direction: 'asc', nulls: 'first' },
								},
							},
							{ id: 'asc' },
						],
					}),
				),
			).toEqual([5, 1, 2, 6]);
		});

		test('TEN-12: shared relation rows participate in loads, filters, counts, and sorts', async () => {
			const a = scoped();
			expect(ids(await a.templates.findMany())).toEqual([1, 3]);
			expect(await a.templates.count()).toBe(2);
			expect(await a.templates.exists({ where: { id: 3 } })).toBe(true);
			const sharedPage = await a.templates.cursor({
				after: { id: 1 },
				limit: 1,
				orderBy: { id: 'asc' },
			});
			expect(ordered(sharedPage.data)).toEqual([3]);
			expect(sharedPage.pagination.hasNext).toBe(false);
			const rows = await a.projects.findMany({
				include: {
					count: { select: { labels: true, templates: true } },
					labels: { orderBy: { id: 'asc' } },
					templates: { orderBy: { id: 'asc' } },
				},
				orderBy: { id: 'asc' },
			});
			expect(rows.map((row) => ordered(row.labels))).toEqual([
				[1, 2],
				[],
			]);
			expect(rows.map((row) => ordered(row.templates))).toEqual([
				[1, 3],
				[],
			]);
			expect(rows.map((row) => row.count)).toEqual([
				{ labels: 2, templates: 2 },
				{ labels: 0, templates: 0 },
			]);
			expect(
				ids(
					await a.projects.findMany({
						where: { labels: { some: { id: 2 } } },
					}),
				),
			).toEqual([1]);
			expect(
				ids(
					await a.projects.findMany({
						where: { templates: { some: { id: 3 } } },
					}),
				),
			).toEqual([1]);
			expect(
				ordered(
					await a.projects.findMany({
						orderBy: [
							{ labels: { count: 'desc' } },
							{ id: 'asc' },
						],
					}),
				),
			).toEqual([1, 2]);
		});

		test('fail-closed root, partial context, junctions, and bypass', async () => {
			const { db } = harness.clients();
			const a = scoped();

			await expect(settle(db.projects.findMany())).rejects.toMatchObject({
				code: 'TENANT_REQUIRED',
			});
			await expect(settle(a.boards.findMany())).rejects.toMatchObject({
				code: 'TENANT_REQUIRED',
				table: 'boards',
			});
			await expect(
				settle(a.projectMembers.findMany()),
			).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
			expect(
				ids(await a.$tenant({ workspaceId: 1 }).boards.findMany()),
			).toEqual([1]);
			expect(ids(await db.plans.findMany())).toEqual([1]);
			expect(
				ids(
					await db
						.$withoutTenant({ reason: 'leak suite' })
						.projects.findMany(),
				),
			).toEqual([1, 2, 3]);
		});

		test('EDGE-04: transactions and savepoints keep the scope', async () => {
			const seen = await scoped().transaction(async (tx) => {
				const outer = ids(await tx.projects.findMany());
				const inner = await tx.transaction(async (nested) =>
					ids(await nested.tasks.findMany()),
				);
				return { inner, outer };
			});

			expect(seen).toEqual({ inner: [1, 2, 5, 6], outer: [1, 2] });
		});
	});

	describe('writes', () => {
		test('SCOPE-07: update and delete never touch another tenant', async () => {
			const a = scoped();

			expect(
				await a.projects.update({
					data: { name: 'x' },
					where: { id: 3 },
				}),
			).toBeNull();
			expect(
				await a.projects.update({
					data: { name: 'x' },
					where: { slug: 'b-p1' },
				}),
			).toBeNull();
			// Not pinned: the single-row path must pick the tenant row.
			const updated = await a.projects.update({
				data: { name: 'a-p2' },
				where: { id: { gte: 2 } },
			});
			expect(Number(updated?.id)).toBe(2);
			expect(await a.projects.delete({ where: { id: 3 } })).toBeNull();
			expect(await projectRows()).toEqual(PROJECTS);

			const deleted = await a.tasks.delete({ where: { projectId: 1 } });
			expect(Number(deleted?.id)).toBe(1);
			expect(
				ids(
					await harness.query(
						'select id from bd_tl_tasks where project_id = 1',
					),
				),
			).toEqual([4, 7]);
		});

		test('SCOPE-07/08: batch writes only affect tenant rows; empty where is a no-op', async () => {
			const a = scoped();
			const { raw } = harness.clients();

			expect(
				await a.projects.updateMany({
					data: { name: 'bulk' },
					where: { id: { in: [1, 3] } },
				}),
			).toMatchObject({ count: 1 });
			expect(
				await a.projects.updateMany({
					data: { name: 'all' },
					where: {},
				}),
			).toEqual({ count: 0 });
			expect(await a.projects.deleteMany({ where: {} })).toEqual({
				count: 0,
			});
			expect(
				await a.projects.updateEach({
					by: raw._.relations.projects.table.id,
					data: [
						{ id: 2, name: 'each' },
						{ id: 3, name: 'each' },
					],
					update: { name: (row) => row.name as string },
				}),
			).toMatchObject({ count: 1 });
			expect(await projectRows()).toEqual([
				{ id: 1, name: 'bulk', organization_id: 'a' },
				{ id: 2, name: 'each', organization_id: 'a' },
				PROJECTS[2],
			]);

			expect(
				await a.tasks.deleteMany({
					where: { projectId: { in: [1, 3] } },
				}),
			).toMatchObject({ count: 2 });
			expect(
				ids(await harness.query('select id from bd_tl_tasks')),
			).toEqual([2, 3, 4, 6, 7]);
		});

		test('TEN-14: creates and upserts stamp the tenant', async () => {
			const a = scoped();

			await a.projects.create({ data: { id: 10, name: 'c', slug: 'c' } });
			await a.projects.createMany({
				data: [
					{ id: 11, name: 'm1', slug: 'm1' },
					{ id: 12, name: 'm2', slug: 'm2' },
				],
			});
			await a.projects.upsert({
				create: { id: 13, name: 'u', slug: 'u' },
				update: { name: 'u' },
				where: { id: 13 },
			});
			await a.tasks.upsertMany({
				data: [{ id: 14, projectId: 1, title: 'um' }],
				target: 'id',
				update: ['title'],
			});

			expect(
				await harness.query(
					'select id, organization_id from bd_tl_projects where id >= 10 order by id',
				),
			).toEqual(
				[10, 11, 12, 13].map((id) => ({ id, organization_id: 'a' })),
			);
			expect(
				await harness.query(
					'select id, organization_id from bd_tl_tasks where id = 14',
				),
			).toEqual([{ id: 14, organization_id: 'a' }]);
		});

		test('TEN-16/18: foreign tenant values are rejected before SQL', async () => {
			const a = scoped();
			const mismatch = { code: 'TENANT_MISMATCH', table: 'projects' };

			await expect(
				a.projects.create({
					data: { id: 10, name: 'x', organizationId: 'b', slug: 'x' },
				}),
			).rejects.toMatchObject(mismatch);
			await expect(
				a.projects.update({
					data: { organizationId: 'b' },
					where: { id: 1 },
				}),
			).rejects.toMatchObject(mismatch);
			await expect(
				a.projects.updateMany({
					data: { organizationId: 'b' },
					where: { id: 1 },
				}),
			).rejects.toMatchObject(mismatch);
			await expect(
				a.tasks.upsertMany({
					data: [
						{
							id: 10,
							organizationId: 'b',
							projectId: 1,
							title: 'x',
						},
					],
					target: 'id',
					update: ['title'],
				}),
			).rejects.toMatchObject({ ...mismatch, table: 'tasks' });
			expect(await projectRows()).toEqual(PROJECTS);
		});

		test(
			mysql
				? 'TEN-22: upsert on another tenant key fails with the duplicate-key error'
				: 'TEN-20: upsert conflicting with another tenant throws TENANT_MISMATCH',
			async () => {
				const a = scoped();
				const failure = mysql
					? { cause: { code: 'ER_DUP_ENTRY' } }
					: { code: 'TENANT_MISMATCH' };

				await expect(
					a.projects.upsert({
						create: { id: 3, name: 'stolen', slug: 'stolen' },
						update: { name: 'stolen' },
						where: { id: 3 },
					}),
				).rejects.toMatchObject(failure);
				await expect(
					a.projects.upsert({
						create: { id: 20, name: 'stolen', slug: 'b-p1' },
						update: { name: 'stolen' },
						where: { slug: 'b-p1' },
					}),
				).rejects.toMatchObject(failure);
				expect(await projectRows()).toEqual(PROJECTS);

				const own = await a.projects.upsert({
					create: { id: 1, name: 'mine', slug: 'a-p1' },
					update: { name: 'mine' },
					where: { id: 1 },
				});
				expect(own?.name).toBe('mine');
			},
		);

		test(
			mysql
				? 'TEN-23: upsertMany leaves other tenants unchanged and counts rows sent'
				: 'TEN-21: upsertMany leaves other tenants unchanged and does not count them',
			async () => {
				const a = scoped();

				const taskRows = () =>
					harness.query(
						'select id, title, organization_id from bd_tl_tasks where id in (1, 3, 10) order by id',
					);

				const result = await a.tasks.upsertMany({
					data: [
						{ id: 1, projectId: 1, title: 'mine' },
						{ id: 3, projectId: 1, title: 'stolen' },
						{ id: 10, projectId: 1, title: 'new' },
					],
					target: 'id',
					update: ['title'],
				});
				expect(result.count).toBe(mysql ? 3 : 2);

				await a.tasks.upsertMany({
					data: [{ id: 3, projectId: 1, title: 'again' }],
					target: 'id',
					update: 'all',
				});
				expect(await taskRows()).toEqual([
					{ id: 1, organization_id: 'a', title: 'mine' },
					{ id: 3, organization_id: 'b', title: 'b-t1' },
					{ id: 10, organization_id: 'a', title: 'new' },
				]);
				expect(
					await harness.query(
						'select project_id from bd_tl_tasks where id = 3',
					),
				).toEqual([{ project_id: 3 }]);
			},
		);

		test('SCOPE-09/TEN-25: connect, disconnect, and set never reach other tenants', async () => {
			const a = scoped();
			const taskProjects = () =>
				harness.query(
					'select id, project_id from bd_tl_tasks order by id',
				);
			const before = await taskProjects();

			await expect(
				a.tasks.create({
					data: {
						id: 20,
						project: { connect: { id: 3 } },
						title: 'x',
					} as never,
				}),
			).rejects.toThrow(MISS);
			await expect(
				a.tasks.update({
					data: { project: { connect: { id: 3 } } },
					where: { id: 1 },
				}),
			).rejects.toThrow(MISS);
			await expect(
				a.projects.update({
					data: { tasks: { connect: { id: 4 } } },
					where: { id: 2 },
				}),
			).rejects.toThrow(MISS);
			await expect(
				a.projects.update({
					data: { members: { connect: [{ id: 2 }] } },
					where: { id: 2 },
				}),
			).rejects.toThrow(MISS);
			await expect(
				a.projects.update({
					data: { members: { set: [{ id: 2 }] } },
					where: { id: 2 },
				}),
			).rejects.toThrow(MISS);
			await expect(
				a.projects.update({
					data: { members: { disconnect: [{ id: 2 }] } },
					where: { id: 1 },
				}),
			).rejects.toThrow(MISS);
			expect(await taskProjects()).toEqual(before);
			expect(await links()).toEqual(LINKS);

			// `set` replaces only the tenant links; the foreign link (1, 2) stays.
			await a.projects.update({
				data: { members: { set: [{ id: 3 }] } },
				where: { id: 1 },
			});
			expect(await links()).toEqual([
				[1, 2],
				[1, 3],
				[2, 1],
				[2, 3],
				[3, 1],
				[3, 2],
			]);
		});

		test('TEN-41: shared NULL rows are read-only for a tenant', async () => {
			const a = scoped();
			const templateRows = () =>
				harness.query(
					'select id, name, organization_id, project_id from bd_tl_templates order by id',
				);
			const shared = {
				id: 3,
				name: 'shared',
				organization_id: null,
				project_id: 1,
			};
			const before = await templateRows();

			expect(ids(await a.templates.findMany())).toEqual([1, 3]);
			expect(
				await a.templates.update({
					data: { name: 'hijacked' },
					where: { id: 3 },
				}),
			).toBeNull();
			expect(
				await a.templates.update({
					data: { name: 'hijacked' },
					where: { name: 'shared' },
				}),
			).toBeNull();
			// Claiming passes the immutability check (equal value) but matches no row.
			expect(
				await a.templates.update({
					data: { organizationId: 'a' },
					where: { id: 3 },
				}),
			).toBeNull();
			expect(
				await a.templates.updateMany({
					data: { name: 'hijacked' },
					where: { id: 3 },
				}),
			).toMatchObject({ count: 0 });
			expect(
				await a.templates.updateEach({
					by: harness.clients().raw._.relations.templates.table.id,
					data: [{ id: 3, name: 'hijacked' }],
					update: { name: (row) => row.name as string },
				}),
			).toMatchObject({ count: 0 });
			expect(await a.templates.delete({ where: { id: 3 } })).toBeNull();
			expect(
				await a.templates.delete({ where: { name: 'shared' } }),
			).toBeNull();
			expect(
				await a.templates.deleteMany({ where: { id: 3 } }),
			).toMatchObject({ count: 0 });
			await expect(
				a.templates.upsert({
					create: { id: 3, name: 'hijacked' },
					update: { name: 'hijacked' },
					where: { id: 3 },
				}),
			).rejects.toMatchObject(
				mysql
					? { cause: { code: 'ER_DUP_ENTRY' } }
					: { code: 'TENANT_MISMATCH' },
			);
			expect(
				await a.templates.upsertMany({
					data: [{ id: 3, name: 'hijacked' }],
					target: 'id',
					update: ['name'],
				}),
			).toMatchObject({ count: mysql ? 1 : 0 });

			// Relation writes that would change the shared row miss it.
			await expect(
				a.projects.update({
					data: { templates: { connect: { id: 3 } } },
					where: { id: 2 },
				}),
			).rejects.toThrow(MISS);
			await expect(
				a.projects.update({
					data: { templates: { disconnect: { id: 3 } } },
					where: { id: 1 },
				}),
			).rejects.toThrow(MISS);
			expect(await templateRows()).toEqual(before);
			// `set` detaches only the tenant row; the shared link stays.
			await a.projects.update({
				data: { templates: { set: [] } },
				where: { id: 1 },
			});
			expect(await templateRows()).toEqual([
				{
					id: 1,
					name: 'a-tpl',
					organization_id: 'a',
					project_id: null,
				},
				{
					id: 2,
					name: 'b-tpl',
					organization_id: 'b',
					project_id: null,
				},
				shared,
			]);

			// Reads still see it; own rows stay writable.
			expect(
				await a.templates.findUnique({ where: { id: 3 } }),
			).toMatchObject({ name: 'shared', organizationId: null });
			expect(
				await a.templates.update({
					data: { name: 'mine' },
					where: { id: 1 },
				}),
			).toMatchObject({ name: 'mine' });

			// Only the audited bypass changes shared rows.
			const bypass = harness
				.clients()
				.db.$withoutTenant({ reason: 'shared rows' });
			expect(
				await bypass.templates.update({
					data: { name: 'renamed' },
					where: { id: 3 },
				}),
			).toMatchObject({ name: 'renamed', organizationId: null });
			expect(
				await bypass.templates.deleteMany({ where: { id: 3 } }),
			).toMatchObject({ count: 1 });
			expect(ids(await templateRows())).toEqual([1, 2]);
		});

		test('TEN-41: batch writes matching own and shared rows change only the own row', async () => {
			const a = scoped();
			const templateRows = () =>
				harness.query(
					'select id, name, organization_id from bd_tl_templates where id in (1, 3) order by id',
				);
			const shared = { id: 3, name: 'shared', organization_id: null };

			expect(
				await a.templates.updateMany({
					data: { name: 'bulk' },
					where: { id: { in: [1, 3] } },
				}),
			).toMatchObject({ count: 1 });
			expect(await templateRows()).toEqual([
				{ id: 1, name: 'bulk', organization_id: 'a' },
				shared,
			]);
			expect(
				await a.templates.deleteMany({ where: { id: { in: [1, 3] } } }),
			).toMatchObject({ count: 1 });
			expect(await templateRows()).toEqual([shared]);
		});

		test('TEN-41: shared NULL junction links survive disconnect and set', async () => {
			const a = scoped();
			const labelLinks = async () =>
				(
					await harness.query(
						'select project_id, label_id, organization_id from bd_tl_project_labels order by project_id, label_id',
					)
				).map((row) => [
					Number(row.project_id),
					Number(row.label_id),
					row.organization_id,
				]);
			const SHARED = [1, 2, null];

			await a.projects.update({
				data: { labels: { disconnect: [{ id: 2 }] } },
				where: { id: 1 },
			});
			expect(await labelLinks()).toEqual([[1, 1, 'a'], SHARED]);

			await a.projects.update({
				data: { labels: { set: [] } },
				where: { id: 1 },
			});
			expect(await labelLinks()).toEqual([SHARED]);

			await harness
				.clients()
				.db.$withoutTenant({ reason: 'shared links' })
				.projects.update({
					data: { labels: { disconnect: [{ id: 2 }] } },
					where: { id: 1 },
				});
			expect(await labelLinks()).toEqual([]);
		});
	});
};
