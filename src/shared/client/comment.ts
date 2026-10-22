import type { AsyncLocalStorage } from 'node:async_hooks';

import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';

type Query = { sql: string };
type Dialect = {
	sqlToQuery(sql: unknown, invokeSource?: unknown): Query;
};

const PATCHED = Symbol.for('better-drizzle/query-comment');
const MAX_COMMENT_LENGTH = 1024;

const hasControlCharacter = (value: string) => {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return true;
	}
	return false;
};

// Shared through the global registry, so a second copy of the library reads
// the store the first copy patched into the dialect.
const STORE = Symbol.for('better-drizzle/query-comment-store');

let storage: AsyncLocalStorage<string> | undefined;
let lastInput: string | undefined;
let lastOutput: string | undefined;

// The store is only created once a comment is used, so clients that never set
// `comment` import nothing and pay nothing.
const getStorage = (operation: string, table: string | undefined) => {
	if (storage) return storage;
	const load = (
		globalThis as {
			process?: { getBuiltinModule?: (id: string) => unknown };
		}
	).process?.getBuiltinModule;
	const mod = load?.('node:async_hooks') as
		| { AsyncLocalStorage: new () => AsyncLocalStorage<string> }
		| undefined;
	if (!mod)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message:
				'`comment` needs AsyncLocalStorage through process.getBuiltinModule (Node 20.16+, Bun, or Workers with nodejs_compat), which this runtime does not provide.',
			operation,
			table,
		});
	const registry = globalThis as unknown as Record<
		symbol,
		AsyncLocalStorage<string> | undefined
	>;
	return (storage = registry[STORE] ??= new mod.AsyncLocalStorage());
};

const invalidComment = (
	operation: string,
	table: string | undefined,
	message: string,
) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.InvalidArgs,
		message,
		operation,
		table,
	});

/**
 * Validates a query comment and makes it safe to embed in `/* ... *\/`:
 * a closing marker is split like `raw` does, everything else that cannot sit
 * inside a one-line comment is rejected.
 */
export const normalizeComment = (
	value: unknown,
	operation: string,
	table?: string,
) => {
	// Call sites repeat the same label, so the last result is reused.
	if (value === lastInput && lastOutput !== undefined) return lastOutput;
	if (typeof value !== 'string')
		throw invalidComment(operation, table, 'comment must be a string.');
	if (!value.trim())
		throw invalidComment(operation, table, 'comment must not be empty.');
	if (value.length > MAX_COMMENT_LENGTH)
		throw invalidComment(
			operation,
			table,
			`comment must be at most ${MAX_COMMENT_LENGTH} characters.`,
		);
	if (hasControlCharacter(value))
		throw invalidComment(
			operation,
			table,
			'comment must not contain control characters.',
		);
	lastInput = value;
	return (lastOutput = value.replaceAll('*/', '* /'));
};

// Builders, relational queries, and raw `execute` all turn SQL into a query
// through the dialect, and the client and its transactions share one dialect.
const patchDialect = (dialect: Dialect, store: AsyncLocalStorage<string>) => {
	if ((dialect as unknown as Record<symbol, unknown>)[PATCHED]) return;
	const original = dialect.sqlToQuery;
	dialect.sqlToQuery = function (this: Dialect, sql, invokeSource) {
		const query = original.call(this, sql, invokeSource);
		const comment = store.getStore();
		if (comment !== undefined) query.sql = `/* ${comment} */ ${query.sql}`;
		return query;
	};
	(dialect as unknown as Record<symbol, unknown>)[PATCHED] = true;
};

/** Whether the call, or the client default, sets a comment. */
export const hasComment = (
	context: { options: { comment?: string } },
	args: unknown,
) =>
	(args as { comment?: unknown } | undefined)?.comment !== undefined ||
	context.options.comment !== undefined;

/**
 * Runs `run` so every statement it issues carries the call's `comment`, or the
 * client default when the call has none. Without either it is a plain call.
 */
export const runWithComment = <Result>(
	context: { db: unknown; options: { comment?: string } },
	args: unknown,
	operation: string,
	table: string | undefined,
	run: () => Result,
): Result => {
	const own = (args as { comment?: unknown } | undefined)?.comment;
	const value = own === undefined ? context.options.comment : own;
	if (value === undefined) return run();

	const comment = normalizeComment(value, operation, table);
	const store = getStorage(operation, table);
	patchDialect((context.db as { dialect: Dialect }).dialect, store);
	return store.run(comment, run);
};
