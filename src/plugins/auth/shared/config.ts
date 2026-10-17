import type {
	AdapterFactoryConfig,
	AdapterFactoryCustomizeAdapterCreator,
} from 'better-auth/adapters';
import type { TableRuntime } from 'better-drizzle';

import { invalid } from './errors';
import type { AdapterState } from './state';

type CreatorHelpers = Parameters<AdapterFactoryCustomizeAdapterCreator>[0];

const ID_ALPHABET =
	'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DATE_WITHOUT_OFFSET =
	/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** Better Auth's default id: 32 characters from `[a-zA-Z0-9]`. */
const generateId = () => {
	let id = '';
	for (const byte of crypto.getRandomValues(new Uint8Array(32)))
		id += ID_ALPHABET[byte % 62];

	return id;
};

/** Text date columns store what Drizzle's date mode writes: ISO 8601, without `T`/`Z` on MySQL. */
const toDateText = (value: unknown, mysql: boolean) => {
	if (!(value instanceof Date)) return value;

	const iso = value.toISOString();
	return mysql ? iso.replace('T', ' ').replace('Z', '') : iso;
};

/**
 * Runs when Better Auth creates the adapter with new options (transaction
 * adapters reuse them): records which auth models get their `id` from a
 * plugin, and rejects tenant-scoped auth tables.
 */
export const inspectAuthTables = (
	state: AdapterState,
	{ getDefaultModelName, getModelName, options, schema }: CreatorHelpers,
) => {
	if (state.authOptions === options) return;

	const generatedIds = new Set<string>();
	for (const name in schema) {
		const key = state.keys[getModelName(name)];
		if (!key) continue;

		const runtime = state.tables[key] as TableRuntime;
		if (runtime.model.generated.includes('id'))
			generatedIds.add(getDefaultModelName(name));

		// Auth tables are shared by every tenant, so tenant() must list them in `global`.
		const scoped = runtime.scopes.some(
			({ definition }) => definition.key === 'tenant',
		);
		if (scoped && state.context.scopes?.tenant !== null)
			throw invalid(
				`The Better Auth table "${key}" is scoped by tenant(). Add it to tenant({ global: [...] }).`,
				key,
			);
	}

	state.authOptions = options;
	state.generatedIds = generatedIds;
};

export const createConfig = (state: AdapterState): AdapterFactoryConfig => {
	const { dialect, keys, tables } = state;
	const pluginIds = Object.values(tables).some((runtime) =>
		runtime.model.generated.includes('id'),
	);

	return {
		adapterId: 'better-drizzle',
		adapterName: 'Better Drizzle Adapter',
		// Leaving the id out lets the plugin fill it; ids Better Auth derives itself still win.
		customIdGenerator: pluginIds
			? ({ model }) =>
					state.generatedIds?.has(model)
						? (undefined as never)
						: generateId()
			: undefined,
		customTransformInput({ data, fieldAttributes, field, model }) {
			if (fieldAttributes.type !== 'date' || data == null) return data;

			const key = keys[model];
			const column = key ? tables[key]?.columns[field] : undefined;
			if (!column?.dataType.startsWith('string')) return data;

			const mysql = dialect === 'mysql';
			return Array.isArray(data)
				? data.map((value) => toDateText(value, mysql))
				: toDateText(data, mysql);
		},
		customTransformOutput({ data, fieldAttributes }) {
			if (fieldAttributes.type !== 'date' || data == null) return data;
			if (data instanceof Date) return data;
			if (typeof data === 'string' && DATE_WITHOUT_OFFSET.test(data))
				return new Date(`${data.replace(' ', 'T')}Z`);

			return new Date(data);
		},
		debugLogs: state.options.debugLogs ?? false,
		supportsArrays: true,
		supportsJSON: true,
		supportsUUIDs: dialect === 'pg',
		usePlural: state.usePlural,
	};
};
