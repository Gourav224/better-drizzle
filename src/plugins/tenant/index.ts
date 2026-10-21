import {
	definePlugin,
	type PluginGeneratedColumns,
	type PluginModelInfo,
	type PluginState,
} from 'better-drizzle';

import { createClientExtension } from './shared/client';
import { denyRaw } from './shared/raw';
import { resolveSettings } from './shared/rls';
import {
	PLUGIN_ID,
	type Resolved,
	SCOPE_KEY,
	assertOptions,
	createScope,
	resolveModels,
	tenantRequired,
} from './shared/scope';
import type {
	TenantColumnKeys,
	TenantExtension,
	TenantGeneratedModels,
	TenantModelOverride,
	TenantOptions,
} from './types';
import { version } from './version';

/**
 * Isolates tenants through core model scopes.
 *
 * Every model with any of the `columns` is scoped by the columns it has:
 * reads, relation loads, relation filters, `count`, relation sorts, writes,
 * upserts, and relation writes only see rows of the active tenant. Creates
 * stamp the tenant columns (optional in create types and zod/ata schemas),
 * and updates cannot change them.
 *
 * - `db.$tenant({ ... })` returns a scoped client; `$tenant.values` holds
 *   the active values.
 * - `db.$withoutTenant({ reason })` returns an unscoped client whose
 *   operations pass `meta.tenantBypass` to hooks.
 * - Without a tenant value, scoped models throw `TENANT_REQUIRED`
 *   (`missing: 'throw'`, the default).
 *
 * @param options - Tenant columns, global models, overrides, raw and RLS policy.
 * @returns A Better Drizzle plugin definition.
 */
export const tenant = <
	const Columns extends string | readonly string[],
	const Global extends readonly string[] = [],
	const Models extends Readonly<
		Record<string, TenantModelOverride<TenantColumnKeys<Columns>>>
	> = Record<never, never>,
	const Strict extends boolean = false,
>(
	options: TenantOptions<Columns, Global, Models, Strict>,
) => {
	const columns: readonly string[] =
		typeof options.columns === 'string'
			? [options.columns]
			: [...(options.columns as readonly string[])];
	const settings = options as TenantOptions;

	const generated = Object.create(null) as Record<
		string,
		readonly string[] | false
	>;
	for (const name of options.global ?? []) generated[name] = false;
	for (const [name, override] of Object.entries(
		(options.models ?? {}) as Readonly<Record<string, TenantModelOverride>>,
	))
		generated[name] =
			override === false || Array.isArray(override)
				? (override as readonly string[] | false)
				: (override as { readonly columns: readonly string[] }).columns;

	const resolved: Resolved = { scoped: {}, settings: {} };

	const plugin = definePlugin<
		TenantOptions<Columns, Global, Models, Strict>,
		Record<never, never>,
		Record<never, never>,
		PluginState,
		Record<never, never>,
		never,
		TenantExtension<
			TenantColumnKeys<Columns>,
			Global[number],
			Models,
			Strict
		>
	>({
		description: 'Isolates tenants through model scopes.',
		extendClient: createClientExtension(
			columns,
			Boolean(settings.rls),
		) as never,
		generated: { column: columns, models: generated },
		id: PLUGIN_ID,
		name: 'Tenant',
		options,
		scope: createScope(settings, resolved) as never,
		setup({ addHook, dialect, models }) {
			assertOptions(settings, dialect);
			const registry = models as Readonly<
				Record<string, PluginModelInfo>
			>;
			const { junctions, scoped } = resolveModels(
				settings,
				columns,
				registry,
			);
			resolved.scoped = scoped;
			resolved.settings = settings.rls
				? resolveSettings(settings, columns, registry)
				: {};

			if ((settings.raw ?? 'deny') === 'deny')
				addHook({ beforeRaw: denyRaw as never });

			// Inherited junctions have no tenant columns, so direct access cannot
			// be scoped; only a `$withoutTenant()` client (or `missing: 'allow'`
			// without values) may use them directly.
			if (!junctions.size) return;
			const guard = (context: {
				model: { name: string };
				scopes: Readonly<Record<string, unknown>> | undefined;
			}) => {
				const name = context.model.name;
				if (!junctions.has(name)) return;
				const state = context.scopes?.[SCOPE_KEY];
				if (state === null) return;
				if (state === undefined && settings.missing === 'allow') return;
				throw tenantRequired(name, columns);
			};
			addHook({
				beforeCreate: (context) => {
					guard(context);
					return context.data;
				},
				beforeDelete: (context) => {
					guard(context);
				},
				beforeQuery: (context) => {
					guard(context);
				},
				beforeUpdate: (context) => {
					guard(context);
					return context.data;
				},
			});
		},
		version,
	});

	// NoInfer: inside `better(db, { plugins: [tenant(...)] })` the expected
	// `AnyPlugin` would otherwise widen the generics and drop the types.
	return plugin as NoInfer<
		Omit<typeof plugin, 'generated'> & {
			generated: PluginGeneratedColumns<
				TenantColumnKeys<Columns>,
				TenantGeneratedModels<Global, Models>,
				unknown
			>;
		}
	>;
};

export default tenant;

declare module 'better-drizzle' {
	interface RawOptionsExtensions {
		/** `'trusted'` runs raw SQL on a tenant-scoped client under `raw: 'deny'`. */
		tenant?: 'trusted';
	}
}

export type * from './types';

export { version };
