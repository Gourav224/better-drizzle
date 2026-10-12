// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import type { Database } from 'bun:sqlite';

import {
	type AnyPlugin,
	type AnySchema,
	type BetterDrizzleClient,
	type ClientExtensionTypeResolver,
	type PluginGeneratedColumns,
	type PluginScopeDefinition,
	type PluginState,
	better,
	definePlugin,
} from 'better-drizzle';
import { defineRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const users = sqliteTable('users', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	region: text('region').notNull(),
	workspace: text('workspace').notNull(),
});
const notes = sqliteTable('notes', {
	id: integer('id').primaryKey(),
	region: text('region').notNull(),
});

declare const client: Database;

const raw = drizzle({ client, relations: defineRelations({ notes, users }) });

const scope: PluginScopeDefinition<Record<string, string>> = {
	bypass: (state) => ({ bypassed: Object.keys(state) }),
	key: 'region',
	mismatch: (model, column) => new Error(`${model.name}.${column}`),
	missing: (model, columns) =>
		columns.length ? new Error(model.name) : undefined,
	model: (model) =>
		model.hasColumn('region')
			? {
					columns: ['region'],
					immutable: true,
					nullable: false,
					stamp: true,
					upsert: true,
				}
			: { where: { deletedAt: null } },
	root: (args) => (args.all ? null : undefined),
	session: (state, dialect) =>
		dialect === 'pg' ? [sql`select ${state.region}`] : undefined,
};

// @ts-expect-error `key` is required.
const noKey: PluginScopeDefinition = { model: () => undefined };
// @ts-expect-error `model` must return a scope model or `undefined`.
const badModel: PluginScopeDefinition = { key: 'x', model: () => 1 };
const badColumns: PluginScopeDefinition = {
	key: 'x',
	// @ts-expect-error `columns` is a list of column keys.
	model: () => ({ columns: 'region' }),
};

type TablesOf<Schema, Meta, Plugins> = {
	$tables: readonly (keyof Schema)[];
	$scoped(): BetterDrizzleClient<
		Schema & AnySchema,
		Meta,
		Plugins & readonly AnyPlugin[]
	>;
};

interface TablesExtension extends ClientExtensionTypeResolver {
	readonly extension: TablesOf<this['schema'], this['meta'], this['plugins']>;
}

const scopedPlugin = definePlugin<
	unknown,
	Record<never, never>,
	Record<never, never>,
	PluginState,
	Record<never, never>,
	never,
	TablesExtension
>({
	extendClient: ({ scope, withScope }) =>
		({
			$scoped: () => withScope({ region: 'eu' }, { reason: 'test' }),
			$tables: [],
			current: scope,
		}) as never,
	id: 'scoped',
	scope,
});
const scoped = scopedPlugin as Omit<typeof scopedPlugin, 'generated'> & {
	generated: PluginGeneratedColumns<
		readonly ['region', 'workspace'],
		Record<never, never>,
		string
	>;
};

const db = better(raw, { plugins: [scoped] });

const tables: readonly ('notes' | 'users')[] = db.$tables;
db.$scoped().users.findMany();
// @ts-expect-error resolver keys come from the schema.
const wrongTables: readonly 'posts'[] = db.$tables;

db.users.$withoutPlugins().findMany();
db.users.$withoutPlugins({ keepScopes: true }).findMany();
// @ts-expect-error `keepScopes` is a boolean.
db.users.$withoutPlugins({ keepScopes: 'yes' });

// Array `generated` makes every listed column optional on create.
db.users.create({ data: { id: 1, name: 'A' } });
db.notes.create({ data: { id: 1 } });

const overridden = definePlugin({ id: 'overridden' }) as Omit<
	ReturnType<typeof definePlugin>,
	'generated'
> & {
	generated: PluginGeneratedColumns<
		readonly ['region'],
		{ users: readonly ['workspace'] },
		string
	>;
};
const partial = better(raw, { plugins: [overridden] });

partial.users.create({ data: { id: 1, name: 'A', region: 'eu' } });
// @ts-expect-error users override generates `workspace` only.
partial.users.create({ data: { id: 1, name: 'A' } });

export { badColumns, badModel, noKey, tables, wrongTables };
