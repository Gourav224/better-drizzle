import type { SQL } from 'drizzle-orm';
import { aliasedTableColumn, and, eq, isNull, or } from 'drizzle-orm';

import type {
	AnyPlugin,
	AnySchema,
	PluginScopeDefinition,
	RuntimeContext,
	ScopeEntry,
	TableRuntime,
	TransactionRuntime,
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
	let sessions: PluginScopeDefinition[] | undefined;

	for (const plugin of plugins) {
		const definition = plugin.scope;
		if (!definition) continue;
		found = true;
		if (definition.session) (sessions ??= []).push(definition);

		for (const name in context.tables) {
			const runtime = context.tables[name] as TableRuntime;
			const model = definition.model(runtime.model);
			if (model)
				runtime.scopes = [...runtime.scopes, { definition, model }];
		}
	}

	if (found) context.scopes = NO_STATE;
	if (sessions) context.plugins.sessions = sessions;
};

const compileScopes = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	alias: string | undefined,
	rootArgs: Record<string, unknown> | undefined,
	conflict: boolean,
	strict: boolean,
) => {
	const scopes = context.scopes as Readonly<Record<string, unknown>>;
	const conditions: SQL[] = [];
	const upsert = conflict || context.upsertScopes === true;

	for (const { definition, model } of runtime.scopes) {
		if (upsert && model.upsert === false) continue;
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
				// Shared `NULL` rows are readable, never writable (strict).
				conditions.push(
					model.nullable && !strict
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
 * alias of a subquery; `rootArgs` applies root-only overrides; `strict`
 * (writes) excludes the `NULL` rows of `nullable` scopes.
 */
export const scopePredicate = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	alias?: string,
	rootArgs?: Record<string, unknown>,
	strict = false,
): SQL | undefined => {
	if (context.scopes === undefined || !runtime.scopes.length) return;
	return compileScopes(context, runtime, alias, rootArgs, false, strict);
};

/**
 * The context a write runs in: root reads that locate the rows to change
 * (MySQL lookups, counts, relational updates, upsert lookups) match `nullable`
 * scope columns strictly.
 */
export const writeContext = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
): RuntimeContext<Schema, Meta> => {
	for (const entry of runtime.scopes)
		if (entry.model.nullable) return { ...context, writeScope: runtime };
	return context;
};

/**
 * Builds the predicate an upsert conflict update must satisfy: every scope
 * except those with `upsert: false`, strict like every write predicate.
 */
export const scopeConflictWhere = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
): SQL | undefined => {
	if (context.scopes === undefined || !runtime.scopes.length) return;
	return compileScopes(context, runtime, undefined, undefined, true, true);
};

/**
 * The context an upsert runs in: scopes with `upsert: false` (soft-delete)
 * are skipped by its reads and writes too, not only by the conflict update.
 */
export const upsertContext = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
): RuntimeContext<Schema, Meta> => {
	for (const entry of runtime.scopes)
		if (entry.model.upsert === false)
			return { ...context, upsertScopes: true };
	return context;
};

/**
 * The error an upsert throws when its conflict update hit a row outside the
 * scope: the definition's mismatch error for the first scoped column.
 */
export const conflictMismatch = (runtime: TableRuntime): Error => {
	for (const entry of runtime.scopes)
		if (entry.model.upsert !== false && entry.model.columns?.length)
			return mismatch(entry, runtime, entry.model.columns[0] as string);
	return new Error(
		`The upsert on "${runtime.model.name}" conflicts with a row outside its scope.`,
	);
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
		const state = scopeValues(
			context as RuntimeContext<AnySchema, unknown>,
			runtime,
			entry,
		);
		if (!state) continue;

		for (const key of entry.model.columns) {
			const value = data[key];
			const expected = state[key];
			if (
				value === undefined ||
				expected === undefined ||
				expected === null
			)
				continue;
			if (value !== expected) throw mismatch(entry, runtime, key);
		}
	}
};

/**
 * Whether `key` is a column of an `immutable` scope with an active value.
 * Batch upserts drop such columns from generated update sets.
 */
export const isImmutableColumn = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	key: string,
) => {
	if (context.scopes === undefined) return false;
	for (const { definition, model } of runtime.scopes) {
		if (!model.immutable || !model.columns?.includes(key)) continue;
		const state = (context.scopes as Readonly<Record<string, unknown>>)[
			definition.key
		] as StateValues;
		const value = state?.[key];
		if (value !== undefined && value !== null) return true;
	}
	return false;
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
		meta
			? mergeMeta(context.scopedMeta, meta as Meta, true)
			: context.scopedMeta,
		Object.freeze(scopes),
	);
};

/**
 * Derives the context of a `$withoutPlugins()` delegate: no scopes, plus the
 * `bypass()` meta of every scope whose state was set.
 */
export const withoutScopes = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
): RuntimeContext<Schema, Meta, Plugins> => {
	const scopes = context.scopes as Readonly<Record<string, unknown>>;
	const plugins: readonly AnyPlugin[] = context.options.plugins ?? [];
	let meta: Record<string, unknown> | undefined;

	for (const plugin of plugins) {
		const definition = plugin.scope;
		if (!definition?.bypass) continue;
		const state = scopes[definition.key];
		if (state === undefined) continue;
		const extra = definition.bypass(state);
		if (extra) meta = { ...meta, ...extra };
	}

	return {
		...context,
		scopedMeta: meta
			? mergeMeta(context.scopedMeta, meta as Meta, true)
			: context.scopedMeta,
		scopes: undefined,
		scopesDisabled: true,
	};
};

/**
 * The `session()` statements of the active scope state, or `undefined` when
 * the client has no session statements to run.
 */
export const sessionStatements = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	previousScopes?: Readonly<Record<string, unknown>>,
): SQL[] | undefined => {
	const definitions = context.plugins.sessions;
	if (!definitions || (context.scopes === undefined && !previousScopes))
		return;
	let statements: SQL[] | undefined;
	for (const definition of definitions) {
		const state = context.scopes?.[definition.key];
		const previous = previousScopes?.[definition.key];
		if (
			(state === undefined || state === null) &&
			(previous === undefined || previous === null)
		)
			continue;
		const sql = definition.session?.(state ?? null, context.dialect);
		if (sql?.length) (statements ??= []).push(...sql);
	}
	return statements;
};

/**
 * Whether a call must open a transaction to run its session statements:
 * the client is outside a transaction and has session SQL to run. With
 * `raw`, only definitions that declare `rawSession` count.
 */
export const needsSession = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	raw = false,
) => {
	const definitions = context.plugins.sessions;
	if (!definitions || context.scopes === undefined || context.transaction)
		return false;
	for (const definition of definitions) {
		if (raw && !definition.rawSession) continue;
		const state = context.scopes[definition.key];
		if (state === undefined || state === null) continue;
		if (definition.session?.(state, context.dialect)?.length) return true;
	}
	return false;
};

/** Whether raw calls run the session statements (`rawSession`). */
export const hasRawSession = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
) => {
	const definitions = context.plugins.sessions;
	if (!definitions || context.scopes === undefined) return false;
	for (const definition of definitions)
		if (definition.rawSession) return true;
	return false;
};

const sameState = (left: unknown, right: unknown) => {
	if (left === right) return true;
	if (
		typeof left !== 'object' ||
		typeof right !== 'object' ||
		left === null ||
		right === null
	)
		return false;
	const a = left as Record<string, unknown>;
	const b = right as Record<string, unknown>;
	let size = 0;
	for (const key in a) {
		if (a[key] !== b[key]) return false;
		size++;
	}
	for (const _ in b) size--;
	return size === 0;
};

// Scope states are rebuilt by every `withScope()`, so compare by value.
const sameScopes = (
	left: Readonly<Record<string, unknown>> | undefined,
	right: Readonly<Record<string, unknown>> | undefined,
) => {
	if (left === right) return true;
	if (!left || !right) return false;
	let size = 0;
	for (const key in left) {
		if (!sameState(left[key], right[key])) return false;
		size++;
	}
	for (const _ in right) size--;
	return size === 0;
};

/**
 * Runs the session statements of the active scope state unless the
 * transaction already applied an equal state. Savepoints start from their
 * parent's state and hand theirs back on release. Outside a transaction it
 * does nothing; callers open one when `sessionStatements()` returns SQL.
 */
export const applySession = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
) => {
	const transaction = context.transaction;
	if (!transaction || !context.plugins.sessions) return;
	if (sameScopes(transaction.sessionScopes, context.scopes)) return;

	const statements = sessionStatements(context, transaction.sessionScopes);
	if (!statements) {
		transaction.sessionScopes = context.scopes;
		return;
	}
	const db = context.db as {
		execute?: (query: SQL) => unknown;
		run?: (query: SQL) => unknown;
	};
	for (const statement of statements)
		await (context.dialect === 'sqlite' ? db.run : db.execute)?.call(
			db,
			statement,
		);
	transaction.sessionScopes = context.scopes;
};

const sessionQueues = new WeakMap<TransactionRuntime, Promise<void>>();

/** Keeps a transaction's session setting and its SQL operation together. */
export const runSessionSql = <Schema extends AnySchema, Meta, Result>(
	context: RuntimeContext<Schema, Meta>,
	run: () => Promise<Result>,
): Promise<Result> => {
	const transaction = context.transaction;
	if (!transaction || !context.plugins.sessions) return run();

	return (async () => {
		let root = transaction;
		while (root.parent) root = root.parent;
		const previous = sessionQueues.get(root);
		let release!: () => void;
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		sessionQueues.set(root, current);
		if (previous) await previous;
		try {
			await applySession(context);
			return await run();
		} finally {
			release();
			if (sessionQueues.get(root) === current) sessionQueues.delete(root);
		}
	})();
};
