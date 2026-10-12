import { Database } from 'bun:sqlite';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { type AnyPlugin, better } from '../../src';
import { type TenantOptions, tenant } from '../../src/plugins/tenant';

export const organizations = sqliteTable('t_organizations', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
});

export const workspaces = sqliteTable('t_workspaces', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

export const projects = sqliteTable('t_projects', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

export const tasks = sqliteTable('t_tasks', {
	id: integer('id').primaryKey(),
	organizationId: text('organization_id').notNull(),
	projectId: integer('project_id').notNull(),
	title: text('title').notNull(),
	workspaceId: integer('workspace_id').notNull(),
});

// Workspace-only table whose column is stored as `ws_id` (EDGE-05).
export const boards = sqliteTable('t_boards', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	workspaceId: integer('ws_id').notNull(),
});

export const members = sqliteTable('t_members', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id').notNull(),
});

// Junction without tenant columns, reached only through `.through()`.
export const projectMembers = sqliteTable('t_project_members', {
	memberId: integer('member_id').notNull(),
	projectId: integer('project_id').notNull(),
});

// Global, but with an owner organization: never filtered nor stamped.
export const plans = sqliteTable('t_plans', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id'),
});

// Nullable model: `NULL` rows are shared by every tenant.
export const templates = sqliteTable('t_templates', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	organizationId: text('organization_id'),
});

export const schema = {
	boards,
	members,
	organizations,
	plans,
	projectMembers,
	projects,
	tasks,
	templates,
	workspaces,
};

export const relations = defineRelations(schema, (r) => ({
	members: {
		projects: r.many.projects({
			from: r.members.id.through(r.projectMembers.memberId),
			to: r.projects.id.through(r.projectMembers.projectId),
		}),
	},
	projects: {
		members: r.many.members({
			from: r.projects.id.through(r.projectMembers.projectId),
			to: r.members.id.through(r.projectMembers.memberId),
		}),
		tasks: r.many.tasks({ from: r.projects.id, to: r.tasks.projectId }),
	},
	tasks: {
		project: r.one.projects({ from: r.tasks.projectId, to: r.projects.id }),
	},
}));

export const DDL = `
CREATE TABLE t_organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE t_workspaces (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT NOT NULL);
CREATE TABLE t_projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT NOT NULL);
CREATE TABLE t_tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, organization_id TEXT NOT NULL, workspace_id INTEGER NOT NULL, project_id INTEGER NOT NULL);
CREATE TABLE t_boards (id INTEGER PRIMARY KEY, name TEXT NOT NULL, ws_id INTEGER NOT NULL);
CREATE TABLE t_members (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT NOT NULL);
CREATE TABLE t_project_members (project_id INTEGER NOT NULL, member_id INTEGER NOT NULL);
CREATE TABLE t_plans (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT);
CREATE TABLE t_templates (id INTEGER PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT);
INSERT INTO t_organizations VALUES ('a', 'Org A'), ('b', 'Org B');
INSERT INTO t_workspaces VALUES (1, 'a-1', 'a'), (2, 'a-2', 'a'), (3, 'b-1', 'b');
INSERT INTO t_projects VALUES (1, 'a-p1', 'a'), (2, 'a-p2', 'a'), (3, 'b-p1', 'b');
INSERT INTO t_tasks VALUES (1, 'a-t1', 'a', 1, 1), (2, 'a-t2', 'a', 2, 1), (3, 'b-t1', 'b', 3, 3);
INSERT INTO t_boards VALUES (1, 'w1-board', 1), (2, 'w3-board', 3);
INSERT INTO t_members VALUES (1, 'a-m1', 'a'), (2, 'b-m1', 'b');
INSERT INTO t_project_members VALUES (1, 1), (1, 2), (3, 2);
INSERT INTO t_plans VALUES (1, 'free', NULL), (2, 'a-custom', 'a');
INSERT INTO t_templates VALUES (1, 'a-tpl', 'a'), (2, 'b-tpl', 'b'), (3, 'shared', NULL);
`;

export const BASE_OPTIONS = {
	columns: ['organizationId', 'workspaceId'],
	global: ['organizations', 'plans'],
	models: { templates: { columns: ['organizationId'], nullable: true } },
} as const;

/** SQLite database with two organizations and three workspaces. */
export const createTenantDb = <const Plugins extends readonly AnyPlugin[] = []>(
	options: Partial<TenantOptions> = {},
	extra: {
		hooks?: Record<string, unknown>;
		plugins?: Plugins;
		queries?: string[];
		raw?: { allowUnsafe?: boolean };
	} = {},
) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(DDL);
	const queries = extra.queries;
	const raw = drizzle({
		client: sqlite,
		logger: queries ? { logQuery: (query) => queries.push(query) } : false,
		relations,
	});
	const db = better(raw, {
		hooks: extra.hooks as never,
		raw: extra.raw,
		plugins: [
			tenant({ ...BASE_OPTIONS, ...options } as typeof BASE_OPTIONS),
			...(extra.plugins ?? []),
		],
	});
	return { db, raw, sqlite };
};

export const ids = (rows: readonly { id: unknown }[]) =>
	rows.map((row) => row.id).sort();
