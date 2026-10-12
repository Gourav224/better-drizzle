import type { SQL } from 'drizzle-orm';
import { aliasedTableColumn, and, eq, isNull, or } from 'drizzle-orm';

import type {
	AnyPlugin,
	AnySchema,
	RuntimeContext,
	ScopeEntry,
	TableRuntime,
} from '../../types';
import { compileWhereInput } from '../query';
import { createDerivedRuntimeContext, mergeMeta } from './context';

const NO_STATE: Readonly<Record<string, unknown>> = Object.freeze(
	Object.create(null) as Record<string, unknown>,
);

type StateValues = Record<string, unknown> | null | undefined;

/**
 * Resolves every plugin scope definition onto the tables it scopes. When at
 * least one plugin declares a scope, the root context gets an empty scope
 * state so static filters apply; otherwise `context.scopes` stays
 * `undefined` and scope sites return without work.
 */
export const resolveScopes = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
) => {
	const plugins: readonly AnyPlugin[] = context.options.plugins ?? [];
	let found = false;

	for (const plugin of plugins) {
		const definition = plugin.scope;
		if (!definition) continue;
		found = true;

		for (const name in context.tables) {
			const runtime = context.tables[name] as TableRuntime;
			const model = definition.model(runtime.model);
			if (model)
				runtime.scopes = [...runtime.scopes, { definition, model }];
		}
	}

	if (found) context.scopes = NO_STATE;
};

const compileScopes = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	alias: string | undefined,
	rootArgs: Record<string, unknown> | undefined,
	conflict: boolean,
) => {
	const scopes = context.scopes as Readonly<Record<string, unknown>>;
	const conditions: SQL[] = [];

	for (const { definition, model } of runtime.scopes) {
		if (conflict && model.upsert === false) continue;
		const state = scopes[definition.key] as StateValues;

		// A `null` state switches the column filter off (an audited bypass).
		if (model.columns && state !== null) {
			let missing: string[] | undefined;
			for (const key of model.columns) {
				const value = state?.[key];
				if (value === undefined || value === null) {
					(missing ??= []).push(key);
					continue;
				}
				const column = runtime.columns[key];
				if (!column) continue;
				const field = alias
					? aliasedTableColumn(column, alias)
					: column;
				conditions.push(
					model.nullable
						? (or(eq(field, value), isNull(field)) as SQL)
						: eq(field, value),
				);
			}
			if (missing) {
				const error = definition.missing?.(runtime.model, missing);
				if (error) throw error;
			}
		}

		const where =
			rootArgs && definition.root
				? definition.root(rootArgs, runtime.model)
				: undefined;
		const filter = where === undefined ? model.where : where;
		if (!filter) continue;

		const clause = compileWhereInput(
			{
				...context,
				rootAlias: alias,
				runtime,
				tableName: runtime.dbName,
			},
			filter,
		);
		if (clause) conditions.push(clause);
	}

	if (!conditions.length) return;
	return conditions.length === 1 ? conditions[0] : and(...conditions);
};

/**
 * Builds the scope predicate of one table reference, or `undefined` when the
 * client has no scopes or the table is unscoped. `alias` names the table
 * alias of a subquery; `rootArgs` applies root-only overrides.
 */
export const scopePredicate = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	alias?: string,
	rootArgs?: Record<string, unknown>,
): SQL | undefined => {
	if (context.scopes === undefined || !runtime.scopes.length) return;
	return compileScopes(context, runtime, alias, rootArgs, false);
};

/**
 * Builds the predicate an upsert conflict update must satisfy: every scope
 * except those with `upsert: false`.
 */
export const scopeConflictWhere = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
): SQL | undefined => {
	if (context.scopes === undefined || !runtime.scopes.length) return;
	return compileScopes(context, runtime, undefined, undefined, true);
};

const scopeValues = (
	context: RuntimeContext<AnySchema, unknown>,
	runtime: TableRuntime,
	entry: ScopeEntry,
) => {
	const state = (context.scopes as Readonly<Record<string, unknown>>)[
		entry.definition.key
	] as StateValues;
	if (state === null) return;

	const columns = entry.model.columns as readonly string[];
	let missing: string[] | undefined;
	for (const key of columns) {
		const value = state?.[key];
		if (value === undefined || value === null) (missing ??= []).push(key);
	}
	if (missing) {
		const error = entry.definition.missing?.(runtime.model, missing);
		if (error) throw error;
	}
	return state ?? undefined;
};

const mismatch = (entry: ScopeEntry, runtime: TableRuntime, key: string) =>
	entry.definition.mismatch?.(runtime.model, key) ??
	new Error(
		`Column "${key}" on "${runtime.model.name}" is outside the scope "${entry.definition.key}".`,
	);

/**
 * Writes the scope values of `stamp` scopes into an insert row. An explicit
 * equal value is kept; a different value throws the definition's mismatch
 * error. Returns the row itself when nothing changes, otherwise a copy.
 */
export const stampInsert = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	row: Record<string, unknown>,
): Record<string, unknown> => {
	if (context.scopes === undefined || !runtime.scopes.length) return row;

	let result = row;
	for (const entry of runtime.scopes) {
		if (!entry.model.stamp || !entry.model.columns) continue;
		const state = scopeValues(
			context as RuntimeContext<AnySchema, unknown>,
			runtime,
			entry,
		);
		if (!state) continue;

		for (const key of entry.model.columns) {
			const value = state[key];
			if (value === undefined || value === null) continue;
			const current = result[key];
			if (current === value) continue;
			if (current !== undefined) throw mismatch(entry, runtime, key);
			if (result === row) result = { ...row };
			result[key] = value;
		}
	}

	return result;
};

/**
 * Rejects update data that changes a column of an `immutable` scope. Setting
 * the column to the active scope value is accepted.
 */
export const assertImmutable = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	data: Record<string, unknown>,
) => {
	if (context.scopes === undefined || !runtime.scopes.length) return;

	for (const entry of runtime.scopes) {
		if (!entry.model.immutable || !entry.model.columns) continue;
		const state = (context.scopes as Readonly<Record<string, unknown>>)[
			entry.definition.key
		] as StateValues;
		if (state === null) continue;

		for (const key of entry.model.columns)
			if (data[key] !== undefined && data[key] !== state?.[key])
				throw mismatch(entry, runtime, key);
	}
};

/**
 * Derives a context whose scope state for `key` is `state` (`undefined`
 * clears it), with `meta` merged into the default meta.
 */
export const withScope = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	key: string,
	state: unknown,
	meta?: Record<string, unknown>,
) => {
	const scopes = Object.assign(
		Object.create(null) as Record<string, unknown>,
		context.scopes,
	);
	if (state === undefined) delete scopes[key];
	else scopes[key] = state;

	return createDerivedRuntimeContext(
		context,
		context.db,
		context.transaction,
		meta ? mergeMeta(context.scopedMeta, meta as Meta) : context.scopedMeta,
		Object.freeze(scopes),
	);
};
