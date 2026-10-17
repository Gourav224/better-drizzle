// Shared PostgreSQL schema for the docs examples. Columns cover the names the
// docs use, so most snippets typecheck without their own schema.
import {
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';

export type AccountSettings = {
	plan: {
		tier: 'free' | 'pro' | 'enterprise';
		seats: number;
		trial: boolean;
	};
	notifications: {
		email: { enabled: boolean; digest: 'daily' | 'weekly' | 'never' };
	};
	nickname: string | null;
	referrer?: string;
	tags: string[];
};

export const role = pgEnum('role', ['admin', 'editor', 'member', 'viewer']);

export const users = pgTable('users', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	active: boolean('active').notNull().default(true),
	age: integer('age'),
	bio: text('bio'),
	nickname: text('nickname'),
	city: text('city'),
	status: text('status'),
	level: integer('level'),
	score: integer('score'),
	tenantId: text('tenant_id'),
	organizationId: integer('organization_id'),
	metadata: jsonb('metadata'),
	tags: text('tags').array(),
	roles: role('roles').array(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at'),
	deletedAt: timestamp('deleted_at'),
});

export const profiles = pgTable('profiles', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	userId: integer('user_id')
		.notNull()
		.unique()
		.references(() => users.id),
	bio: text('bio'),
	city: text('city'),
});

export const posts = pgTable('posts', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id),
	title: text('title').notNull(),
	slug: text('slug').unique(),
	body: text('body'),
	content: text('content'),
	published: boolean('published').notNull().default(false),
	archived: boolean('archived').notNull().default(false),
	status: text('status'),
	views: integer('views').notNull().default(0),
	rank: integer('rank'),
	score: integer('score'),
	tenantId: text('tenant_id'),
	metadata: jsonb('metadata'),
	tags: text('tags').array().notNull().default([]),
	editors: uuid('editors').array(),
	roles: role('roles').array(),
	scores: integer('scores').array(),
	flags: text('flags').array(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at'),
	deletedAt: timestamp('deleted_at'),
});

export const comments = pgTable('comments', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	postId: integer('post_id')
		.notNull()
		.references(() => posts.id),
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id),
	body: text('body').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tags = pgTable('tags', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
});

export const postTags = pgTable(
	'post_tags',
	{
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id),
		tagId: integer('tag_id')
			.notNull()
			.references(() => tags.id),
	},
	(t) => [primaryKey({ columns: [t.postId, t.tagId] })],
);

export const groups = pgTable('groups', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	name: text('name').notNull(),
});

export const memberships = pgTable(
	'memberships',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		groupId: integer('group_id')
			.notNull()
			.references(() => groups.id),
	},
	(t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

export const accounts = pgTable('accounts', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	userId: integer('user_id').references(() => users.id),
	name: text('name').notNull(),
	status: text('status'),
	balance: integer('balance').notNull().default(0),
	loginCount: integer('login_count').notNull().default(0),
	retries: integer('retries').notNull().default(0),
	locked: boolean('locked').notNull().default(false),
	version: integer('version').notNull().default(0),
	settings: jsonb('settings').$type<AccountSettings>().notNull(),
});

export const orders = pgTable('orders', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	status: text('status').notNull().default('pending'),
	total: integer('total').notNull().default(0),
	tenantId: text('tenant_id'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const jobs = pgTable('jobs', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	status: text('status').notNull().default('pending'),
	attempts: integer('attempts').notNull().default(0),
	payload: jsonb('payload'),
	runAt: timestamp('run_at').notNull().defaultNow(),
	lockedAt: timestamp('locked_at'),
});

export const organizations = pgTable('organizations', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	name: text('name').notNull(),
});

export const projects = pgTable('projects', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	organizationId: integer('organization_id')
		.notNull()
		.references(() => organizations.id),
	name: text('name').notNull(),
	archived: boolean('archived').notNull().default(false),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});
