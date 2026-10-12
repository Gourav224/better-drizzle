import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	type PluginDialect,
	type PluginModelInfo,
	type PluginScopeDefinition,
	type PluginScopeModel,
} from 'better-drizzle';

import type { TenantModelOverride, TenantOptions } from '../types';
import { rlsSession } from './rls';

export const PLUGIN_ID = 'better-drizzle/tenant';
export const SCOPE_KEY = 'tenant';

export type TenantState = Readonly<Record<string, unknown>>;

export const invalid = (message: string, details?: Record<string, unknown>) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.InvalidArgs,
		details: { pluginId: PLUGIN_ID, ...details },
		message,
	});

const quote = (columns: readonly string[]) =>
	columns.map((column) => `"${column}"`).join(', ');

/** Bootstrap checks of option combinations that depend on the dialect. */
export const assertOptions = (
	options: TenantOptions,
	dialect: PluginDialect,
) => {
	const columns =
		typeof options.columns === 'string'
			? [options.columns]
			: options.columns;
	if (
		!Array.isArray(columns) ||
		columns.length === 0 ||
		columns.some((column) => typeof column !== 'string' || !column) ||
		new Set(columns).size !== columns.length
	)
		throw invalid(
			`Plugin "${PLUGIN_ID}": \`columns\` must contain distinct, non-empty column names.`,
			{ option: 'columns' },
		);
	if (options.rls && dialect !== 'pg')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.PluginDialectUnsupported,
			details: { option: 'rls', pluginId: PLUGIN_ID },
			dialect,
			message: `Plugin "${PLUGIN_ID}" supports \`rls\` only on PostgreSQL, got "${dialect}".`,
		});
	if (options.raw === 'set-local' && !options.rls)
		throw invalid(
			`Plugin "${PLUGIN_ID}": \`raw: 'set-local'\` requires \`rls\`.`,
			{ option: 'raw' },
		);
	if (options.strict && options.missing === 'allow')
		throw invalid(
			`Plugin "${PLUGIN_ID}": \`strict\` cannot be combined with \`missing: 'allow'\`.`,
			{ option: 'strict' },
		);
};

/**
 * Resolves the scope of every model. Returns the scope models keyed by
 * table key and the junctions that inherit the scope of both ends.
 */
export const resolveModels = (
	options: TenantOptions,
	columns: readonly string[],
	models: Readonly<Record<string, PluginModelInfo>>,
) => {
	const global = options.global ?? [];
	const overrides = (options.models ?? {}) as Readonly<
		Record<string, TenantModelOverride>
	>;
	const nullable = Object.create(null) as Record<string, boolean>;
	const scoped = Object.create(null) as Record<string, PluginScopeModel>;
	const unscoped: string[] = [];

	for (const name in models) {
		const model = models[name] as PluginModelInfo;
		const override = overrides[name];
		if (override === false || global.includes(name)) continue;

		let keys: readonly string[];
		if (override) {
			const listed = Array.isArray(override)
				? (override as readonly string[])
				: (override as { readonly columns: readonly string[] }).columns;
			for (const key of listed) {
				if (!columns.includes(key))
					throw invalid(
						`Plugin "${PLUGIN_ID}": model "${name}" lists "${key}", which is not one of the tenant columns ${quote(columns)}.`,
						{ column: key, model: name },
					);
				if (!model.hasColumn(key))
					throw new BetterDrizzleError({
						code: BetterDrizzleErrorCode.PluginRequiredColumnMissing,
						column: key,
						details: { pluginId: PLUGIN_ID },
						message: `Plugin "${PLUGIN_ID}" requires column "${key}" on model "${name}".`,
						table: name,
					});
			}
			keys = listed;
			if (!Array.isArray(override))
				nullable[name] = Boolean(
					(override as { readonly nullable?: boolean }).nullable,
				);
		} else keys = columns.filter((key) => model.hasColumn(key));

		if (!keys.length) {
			unscoped.push(name);
			continue;
		}

		scoped[name] = {
			columns: keys,
			immutable: true,
			nullable: nullable[name] || undefined,
			stamp: true,
		};
	}

	// A model without tenant columns may only be a junction reached through
	// `.through()` relations whose both ends are scoped.
	const junctions = new Set<string>();
	for (const name of unscoped) {
		let through = false;
		let direct = false;
		for (const source in models)
			for (const relation of Object.values(
				(models[source] as PluginModelInfo).relations,
			)) {
				if (relation.model === name) direct = true;
				if (relation.through !== name) continue;
				through = true;
				if (!scoped[source] || !scoped[relation.model]) direct = true;
			}

		if (through && !direct) {
			junctions.add(name);
			continue;
		}

		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.PluginRequiredColumnMissing,
			column: columns[0],
			details: { columns, pluginId: PLUGIN_ID },
			message: `Plugin "${PLUGIN_ID}" requires one of the columns ${quote(columns)} on model "${name}"; list it in \`global\` or set \`models.${name}: false\` to leave it unscoped.`,
			table: name,
		});
	}

	return { junctions, scoped };
};

/** Error thrown when a scoped model runs without a tenant value. */
export const tenantRequired = (model: string, columns: readonly string[]) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.TenantRequired,
		column: columns[0],
		details: { columns, pluginId: PLUGIN_ID },
		message: `Model "${model}" requires a tenant value for ${quote(columns)}. Use db.$tenant({ ... }) or db.$withoutTenant({ reason }).`,
		table: model,
	});

/** Bootstrap results, filled by `setup()` before the core resolves scopes. */
export type Resolved = {
	scoped: Readonly<Record<string, PluginScopeModel>>;
	settings: Readonly<Record<string, string>>;
};

/** The `tenant` scope definition. */
export const createScope = (
	options: TenantOptions,
	resolved: Resolved,
): PluginScopeDefinition<TenantState | null> => ({
	bypass: (state) =>
		state === null
			? undefined
			: { tenantBypass: { reason: '$withoutPlugins' } },
	key: SCOPE_KEY,
	mismatch: (model, column) =>
		new BetterDrizzleError({
			code: BetterDrizzleErrorCode.TenantMismatch,
			column,
			details: { pluginId: PLUGIN_ID },
			message: `Column "${column}" on model "${model.name}" must match the active tenant.`,
			table: model.name,
		}),
	missing:
		options.missing === 'allow'
			? undefined
			: (model, columns) => tenantRequired(model.name, columns),
	model: (model) => resolved.scoped[model.name],
	rawSession: options.raw === 'set-local',
	session: options.rls ? rlsSession(() => resolved.settings) : undefined,
});
