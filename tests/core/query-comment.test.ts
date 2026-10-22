import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

const authors = sqliteTable('comment_authors', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});
const posts = sqliteTable('comment_posts', {
	id: integer('id').primaryKey(),
	authorId: integer('author_id').notNull(),
});
const relations = defineRelations({ authors, posts }, (r) => ({
	authors: {
		posts: r.many.posts({ from: r.authors.id, to: r.posts.authorId }),
	},
}));

const sqlite = new Database(':memory:');
const logged: string[] = [];
const raw = drizzle({
	client: sqlite,
	logger: { logQuery: (query) => void logged.push(query) },
	relations,
});
const db = better(raw);

beforeAll(() => {
	sqlite.exec(`
		CREATE TABLE comment_authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
		CREATE TABLE comment_posts (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL);
		INSERT INTO comment_authors VALUES (1, 'Ana'), (2, 'Bia');
		INSERT INTO comment_posts VALUES (1, 1), (2, 1), (3, 2);
	`);
});

beforeEach(() => {
	logged.length = 0;
});

afterAll(() => sqlite.close());

const reject = (run: () => unknown) =>
	expect(Promise.resolve(run())).rejects.toMatchObject({
		code: 'INVALID_ARGS',
	});

test('every statement of a read carries the comment, relation stages included', async () => {
	await db.authors.findMany({
		comment: 'authors.list',
		include: { posts: true },
	});
	expect(logged.length).toBeGreaterThan(1);
	for (const query of logged)
		expect(query.startsWith('/* authors.list */ ')).toBe(true);
});

test('calls without a comment are left alone', async () => {
	await db.authors.findMany({ include: { posts: true } });
	expect(logged.length).toBeGreaterThan(0);
	for (const query of logged) expect(query).not.toContain('/*');
});

test('count, paginate, and writes carry the comment', async () => {
	await db.authors.count({ comment: 'c.count' });
	await db.authors.paginate({
		comment: 'c.page',
		orderBy: { id: 'asc' },
		page: 1,
		perPage: 1,
	});
	await db.authors.update({
		comment: 'c.update',
		data: { name: 'Ana' },
		where: { id: 1 },
	});
	for (const [name, query] of [
		['c.count', logged[0]],
		['c.page', logged[1]],
		['c.update', logged.at(-1)],
	] as const)
		expect(query?.startsWith(`/* ${name} */ `)).toBe(true);
	expect(logged.every((query) => query.startsWith('/* c.'))).toBe(true);
});

test('a transaction statement carries the comment of its own call', async () => {
	await db.transaction(async (tx) => {
		await tx.authors.findMany({ comment: 'in.tx' });
		await tx.authors.findMany();
	});
	expect(logged.some((query) => query.startsWith('/* in.tx */ '))).toBe(true);
	expect(logged.at(-1)).not.toContain('/*');
});

test('concurrent calls keep their own comment', async () => {
	await Promise.all([
		db.authors.findMany({ comment: 'one' }),
		db.authors.findMany({ comment: 'two' }),
	]);
	expect(logged.filter((query) => query.startsWith('/* one */')).length).toBe(
		1,
	);
	expect(logged.filter((query) => query.startsWith('/* two */')).length).toBe(
		1,
	);
});

test('the closing marker is split so the comment cannot end early', async () => {
	await db.authors.findMany({ comment: 'a */ select 1; --' });
	expect(logged[0]?.startsWith('/* a * / select 1; -- */ ')).toBe(true);
});

test('invalid comments throw INVALID_ARGS before running', async () => {
	for (const comment of [
		'',
		'   ',
		'line\nbreak',
		'nul\u0000byte',
		'x'.repeat(1025),
		5,
	])
		await reject(() => db.authors.findMany({ comment: comment as never }));
	expect(logged).toHaveLength(0);
});

test('the client default applies and the call replaces it', async () => {
	const defaulted = better(raw, { comment: 'app=api' });
	await defaulted.authors.findMany();
	await defaulted.authors.findMany({ comment: 'users.list' });
	expect(logged[0]?.startsWith('/* app=api */ ')).toBe(true);
	expect(logged[1]?.startsWith('/* users.list */ ')).toBe(true);
});

test('a before hook can change the comment through args', async () => {
	const hooked = better(raw, {
		hooks: {
			beforeQuery(ctx) {
				ctx.args.comment = `${ctx.args.comment ?? 'x'}+hook`;
			},
		},
	});
	await hooked.authors.findMany({ comment: 'base' });
	expect(logged[0]?.startsWith('/* base+hook */ ')).toBe(true);
});

test('a prepared read keeps the comment fixed at prepare time', async () => {
	const prepared = db.authors
		.findMany({ comment: 'prepared.list', where: { id: 1 } })
		.prepare();
	logged.length = 0;
	await prepared.execute();
	await prepared.execute();
	expect(logged.length).toBe(2);
	for (const query of logged)
		expect(query.startsWith('/* prepared.list */ ')).toBe(true);
});

test('a repeated label keeps working (the last result is reused)', async () => {
	for (let index = 0; index < 3; index += 1)
		await db.authors.findMany({ comment: 'same.label' });
	expect(logged).toHaveLength(3);
	for (const query of logged)
		expect(query.startsWith('/* same.label */ ')).toBe(true);
});

test('a failing call does not leak its comment into the next one', async () => {
	await reject(() => db.authors.findMany({ comment: '' }));
	await db.authors.findMany();
	expect(logged).toHaveLength(1);
	expect(logged[0]).not.toContain('/*');
});

test('the statement text is the original SQL after the prefix', async () => {
	await db.authors.findMany({ where: { id: 1 } });
	const plain = logged[0] as string;
	logged.length = 0;
	await db.authors.findMany({ comment: 'p', where: { id: 1 } });
	expect(logged[0]).toBe(`/* p */ ${plain}`);
});
