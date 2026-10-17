import type { BetterAuthOptions } from 'better-auth';
import type {
	PluginDialect,
	RuntimeContext,
	TableRuntime,
} from 'better-drizzle';

import type { AuthAdapterOptions } from '../types';
import { invalid } from './errors';

export type Row = Record<string, unknown>;

export interface Delegate {
	[method: string]: (args?: Row) => PromiseLike<unknown>;
}

/** A root or transaction Better Drizzle client. */
export interface Client {
	[key: string]: unknown;
	transaction<T>(callback: (tx: Client) => Promise<T>): Promise<T>;
}

export interface ResolvedJoin {
	/** Better Auth's key for the joined rows. */
	key: string;
	kind: 'one' | 'many';
	/** The relation name in `defineRelations()`. */
	relation: string;
}

/** Everything the adapter computes once per `adapter()` call. */
export interface AdapterState {
	/** Better Auth options, set when Better Auth creates the adapter. */
	authOptions?: BetterAuthOptions;
	context: RuntimeContext<never>;
	dialect: PluginDialect;
	/** Default Better Auth model names whose `id` a plugin such as `uuids()` fills. */
	generatedIds?: Set<string>;
	/** Table key by table key or database table name. */
	keys: Record<string, string>;
	joins: Map<string, ResolvedJoin>;
	options: AuthAdapterOptions;
	/** Extra args for reads: `{ cache: false }` when the cache plugin is installed. */
	readArgs: Row | undefined;
	root: Client;
	tables: Record<string, TableRuntime>;
	usePlural: boolean;
}

const CONTEXT = Symbol.for('better-drizzle/context');

export const createState = (
	db: object,
	options: AuthAdapterOptions,
): AdapterState => {
	const context = (db as Record<symbol, unknown>)[CONTEXT] as
		| RuntimeContext<never>
		| undefined;
	if (!context)
		throw invalid(
			'adapter() expects a Better Drizzle client created with better().',
		);

	const { dialect, tables } = context;
	const keys = Object.create(null) as Record<string, string>;
	for (const key in tables) {
		keys[key] = key;
		keys[(tables[key] as TableRuntime).dbName] ??= key;
	}

	const cached = context.plugins.meta.some(
		({ id }) => id === 'better-drizzle/cache',
	);

	return {
		context,
		dialect,
		joins: new Map(),
		keys,
		options,
		readArgs: cached && !options.cache ? { cache: false } : undefined,
		root: (options.meta
			? (db as { $withContext(meta: Row): unknown }).$withContext(
					options.meta,
				)
			: db) as Client,
		tables,
		usePlural: options.usePlural ?? (!tables.user && Boolean(tables.users)),
	};
};

export const resolveTable = (state: AdapterState, model: string) => {
	const key = state.keys[model];
	if (!key)
		throw invalid(
			`No table for the Better Auth model "${model}". Generate the schema with \`npx auth generate\` or map the model with \`modelName\`.`,
			model,
		);

	return { key, runtime: state.tables[key] as TableRuntime };
};

export const getColumn = (
	runtime: TableRuntime,
	model: string,
	field: string,
) => {
	const column = Object.hasOwn(runtime.columns, field)
		? runtime.columns[field]
		: undefined;
	if (!column)
		throw invalid(
			`The field "${field}" does not exist on the "${model}" table. Update the schema or map the field with \`fields\`.`,
			model,
			{ field },
		);

	return column;
};

export const primaryKeyWhere = (runtime: TableRuntime, row: Row) => {
	const where = Object.create(null) as Row;
	for (const field of runtime.primaryKeyFields) where[field] = row[field];

	return where;
};
