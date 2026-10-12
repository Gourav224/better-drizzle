import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';

import { aliasedTable, asc, defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import {
	type AnyPlugin,
	type PluginScopeDefinition,
	type TableRuntime,
	definePlugin,
} from '../../src';
import { createRuntimeContext } from '../../src/shared/client/context';
import {
	assertImmutable,
	resolveScopes,
	scopeConflictWhere,
	scopePredicate,
	stampInsert,
	withScope,
} from '../../src/shared/client/scopes';

const items = sqliteTable('items', {
	id: integer('id').primaryKey(),
	region: text('region_code'),
	deletedAt: text('deleted_at'),
});
const tags = sqliteTable('tags', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});
const relations = defineRelations({ items, tags });

let sqlite: Database | undefined;

afterEach(() => {
	sqlite?.close();
	sqlite = undefined;
});

const setup = (definition: PluginScopeDefinition, extra?: AnyPlugin) => {
	sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE items (id INTEGER PRIMARY KEY, region_code TEXT, deleted_at TEXT);
		CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
		INSERT INTO items VALUES (1, 'eu', NULL), (2, 'us', NULL), (3, NULL, NULL), (4, 'eu', '2024-01-01');
		INSERT INTO tags VALUES (1, 'a');
	`);
	const raw = drizzle({ client: sqlite, relations });
	const plugins = [
		definePlugin({ id: 'scope', scope: definition }),
		...(extra ? [extra] : []),
	];
	const context = createRuntimeContext(raw, { plugins });
	resolveScopes(context);
	return {
		context,
		raw,
		runtime: context.tables.items as TableRuntime,
	};
};

const region: PluginScopeDefinition = {
	key: 'region',
	mismatch: (model, column) => new Error(`mismatch ${model.name}.${column}`),
	missing: (model, columns) =>
		new Error(`missing ${model.name}: ${columns.join(',')}`),
	model: (model) =>
		model.hasColumn('region')
			? { columns: ['region'], immutable: true, stamp: true }
			: undefined,
};

describe('model scope runtime', () => {
	test('equality scope matches only rows with the state value', async () => {
		const { context, raw, runtime } = setup(region);
		const scoped = withScope(context, 'region', { region: 'eu' });

		const rows = await raw
			.select({ id: items.id })
			.from(items)
			.where(scopePredicate(scoped, runtime))
			.orderBy(asc(items.id));

		expect(rows).toEqual([{ id: 1 }, { id: 4 }]);
		expect(context.scopes).toEqual({});
	});

	test('nullable scope also matches NULL rows', async () => {
		const { context, raw, runtime } = setup({
			...region,
			model: () => ({ columns: ['region'], nullable: true }),
		});
		const scoped = withScope(context, 'region', { region: 'us' });

		const rows = await raw
			.select({ id: items.id })
			.from(items)
			.where(scopePredicate(scoped, runtime))
			.orderBy(asc(items.id));

		expect(rows).toEqual([{ id: 2 }, { id: 3 }]);
	});

	test('static where applies without state and root override replaces it', async () => {
		const { context, raw, runtime } = setup({
			key: 'softDelete',
			model: (model) =>
				model.hasColumn('deletedAt')
					? { where: { deletedAt: null } }
					: undefined,
			root: (args) =>
				args.deleted === 'with'
					? null
					: args.deleted === 'only'
						? { deletedAt: { not: null } }
						: undefined,
		});
		const read = (rootArgs?: Record<string, unknown>) =>
			raw
				.select({ id: items.id })
				.from(items)
				.where(scopePredicate(context, runtime, undefined, rootArgs))
				.orderBy(asc(items.id));

		expect(await read()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
		expect(await read({})).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
		expect(await read({ deleted: 'with' })).toEqual([
			{ id: 1 },
			{ id: 2 },
			{ id: 3 },
			{ id: 4 },
		]);
		expect(await read({ deleted: 'only' })).toEqual([{ id: 4 }]);
	});

	test('missing state values throw the definition error before SQL', () => {
		const { context, runtime } = setup(region);

		expect(() => scopePredicate(context, runtime)).toThrow(
			'missing items: region',
		);
		expect(() => stampInsert(context, runtime, { id: 9 })).toThrow(
			'missing items: region',
		);
	});

	test('missing values without a missing() hook leave the column unfiltered', async () => {
		const { context, raw, runtime } = setup({
			key: 'region',
			model: () => ({ columns: ['region'] }),
		});

		expect(scopePredicate(context, runtime)).toBeUndefined();
		const rows = await raw.select({ id: items.id }).from(items);
		expect(rows).toHaveLength(4);
	});

	test('a null state switches the column filter off', () => {
		const { context, runtime } = setup(region);
		const bypassed = withScope(context, 'region', null);

		expect(scopePredicate(bypassed, runtime)).toBeUndefined();
	});

	test('aliased predicates reference the alias', async () => {
		const { context, raw, runtime } = setup(region);
		const scoped = withScope(context, 'region', { region: 'us' });
		const alias = aliasedTable(items, 'scoped_items');

		const rows = await raw
			.select({ id: alias.id })
			.from(alias)
			.where(scopePredicate(scoped, runtime, 'scoped_items'));

		expect(rows).toEqual([{ id: 2 }]);
	});

	test('upsert: false scopes are left out of the conflict predicate', async () => {
		const { context, raw, runtime } = setup(
			{
				key: 'softDelete',
				model: () => ({ upsert: false, where: { deletedAt: null } }),
			},
			definePlugin({ id: 'region', scope: region }),
		);
		const scoped = withScope(context, 'region', { region: 'eu' });

		const rows = await raw
			.select({ id: items.id })
			.from(items)
			.where(scopeConflictWhere(scoped, runtime))
			.orderBy(asc(items.id));

		expect(rows).toEqual([{ id: 1 }, { id: 4 }]);
	});

	test('stampInsert fills, accepts equal values, and rejects others', () => {
		const { context, runtime } = setup(region);
		const scoped = withScope(context, 'region', { region: 'eu' });
		const row = { id: 9 };

		expect(stampInsert(scoped, runtime, row)).toEqual({
			id: 9,
			region: 'eu',
		});
		expect(row).toEqual({ id: 9 });
		const equal = { id: 9, region: 'eu' };
		expect(stampInsert(scoped, runtime, equal)).toBe(equal);
		expect(() =>
			stampInsert(scoped, runtime, { id: 9, region: 'us' }),
		).toThrow('mismatch items.region');
	});

	test('assertImmutable rejects changes to scope columns', () => {
		const { context, runtime } = setup(region);
		const scoped = withScope(context, 'region', { region: 'eu' });

		expect(() =>
			assertImmutable(scoped, runtime, { region: 'eu' }),
		).not.toThrow();
		expect(() => assertImmutable(scoped, runtime, { id: 2 })).not.toThrow();
		expect(() =>
			assertImmutable(scoped, runtime, { region: 'us' }),
		).toThrow('mismatch items.region');
	});

	test('unscoped tables and clients without scope plugins do no work', () => {
		const { context } = setup(region);
		const tagsRuntime = context.tables.tags as TableRuntime;

		expect(tagsRuntime.scopes).toHaveLength(0);
		expect(scopePredicate(context, tagsRuntime)).toBeUndefined();

		const plain = createRuntimeContext(
			drizzle({ client: sqlite as Database, relations }),
			{},
		);
		resolveScopes(plain);
		const plainItems = plain.tables.items as TableRuntime;
		const plainTags = plain.tables.tags as TableRuntime;

		expect(plain.scopes).toBeUndefined();
		expect(plainItems.scopes).toBe(plainTags.scopes);
		expect(Object.isFrozen(plainItems.scopes)).toBe(true);
		expect(scopePredicate(plain, plainItems)).toBeUndefined();
		const row = { id: 1 };
		expect(stampInsert(plain, plainItems, row)).toBe(row);
	});
});
