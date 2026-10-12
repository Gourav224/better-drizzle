import { afterAll, beforeAll, describe } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { better } from '../../src';
import { tenant } from '../../src/plugins/tenant';
import {
	LEAK_OPTIONS,
	LEAK_SEED,
	LEAK_TABLES,
	type LeakClients,
	runLeakSuite,
} from './leak-suite';

const name = (column: string) => varchar(column, { length: 64 }).notNull();

const schema = {
	boards: mysqlTable('bd_tl_boards', {
		id: int('id').primaryKey(),
		name: name('name'),
		organizationId: name('organization_id'),
		workspaceId: int('workspace_id').notNull(),
	}),
	labels: mysqlTable('bd_tl_labels', {
		id: int('id').primaryKey(),
		name: name('name'),
		organizationId: name('organization_id'),
	}),
	members: mysqlTable('bd_tl_members', {
		id: int('id').primaryKey(),
		name: name('name'),
		organizationId: name('organization_id'),
	}),
	plans: mysqlTable('bd_tl_plans', {
		id: int('id').primaryKey(),
		name: name('name'),
	}),
	projectLabels: mysqlTable('bd_tl_project_labels', {
		labelId: int('label_id').notNull(),
		organizationId: varchar('organization_id', { length: 64 }),
		projectId: int('project_id').notNull(),
	}),
	projectMembers: mysqlTable('bd_tl_project_members', {
		memberId: int('member_id').notNull(),
		projectId: int('project_id').notNull(),
	}),
	projects: mysqlTable('bd_tl_projects', {
		id: int('id').primaryKey(),
		name: name('name'),
		organizationId: name('organization_id'),
		slug: name('slug').unique(),
	}),
	tasks: mysqlTable('bd_tl_tasks', {
		id: int('id').primaryKey(),
		organizationId: name('organization_id'),
		projectId: int('project_id').notNull(),
		title: name('title'),
	}),
	templates: mysqlTable('bd_tl_templates', {
		id: int('id').primaryKey(),
		name: name('name'),
		organizationId: varchar('organization_id', { length: 64 }),
		projectId: int('project_id'),
	}),
};

const relations = defineRelations(schema, (r) => ({
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

const MYSQL_URL = process.env.MYSQL_URL;

describe.skipIf(!MYSQL_URL)('tenant isolation (MySQL)', () => {
	let connection: mysql.Connection;
	let clients: LeakClients;

	beforeAll(async () => {
		connection = await mysql.createConnection({
			multipleStatements: true,
			uri: MYSQL_URL,
		});
		await connection.query(`
			drop table if exists ${LEAK_TABLES.join(', ')};
			create table bd_tl_plans (id int primary key, name varchar(64) not null);
			create table bd_tl_projects (id int primary key, name varchar(64) not null, slug varchar(64) not null unique, organization_id varchar(64) not null);
			create table bd_tl_tasks (id int primary key, title varchar(64) not null, organization_id varchar(64) not null, project_id int not null);
			create table bd_tl_members (id int primary key, name varchar(64) not null, organization_id varchar(64) not null);
			create table bd_tl_project_members (project_id int not null, member_id int not null);
			create table bd_tl_boards (id int primary key, name varchar(64) not null, organization_id varchar(64) not null, workspace_id int not null);
			create table bd_tl_templates (id int primary key, name varchar(64) not null, organization_id varchar(64), project_id int);
			create table bd_tl_labels (id int primary key, name varchar(64) not null, organization_id varchar(64) not null);
			create table bd_tl_project_labels (project_id int not null, label_id int not null, organization_id varchar(64));
		`);
		const raw = drizzle({ client: connection, mode: 'default', relations });
		clients = {
			db: better(raw, { plugins: [tenant(LEAK_OPTIONS)] }),
			raw,
		} as unknown as LeakClients;
	});

	afterAll(async () => {
		await connection?.query(
			`drop table if exists ${LEAK_TABLES.join(', ')}`,
		);
		await connection?.end();
	});

	runLeakSuite({
		clients: () => clients,
		dialect: 'mysql',
		query: async (text) =>
			(await connection.query(text))[0] as Record<string, unknown>[],
		reset: async () => {
			await connection.query(
				`delete from ${LEAK_TABLES.join('; delete from ')}; ${LEAK_SEED.join('; ')}`,
			);
		},
	});
});
