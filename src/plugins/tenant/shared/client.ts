import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	type PluginClientExtensionContext,
} from 'better-drizzle';

import { PLUGIN_ID, type TenantState, invalid } from './scope';

const EMPTY: TenantState = Object.freeze({});

/** Builds `$tenant` and `$withoutTenant` for one bound client. */
export const createClientExtension =
	(columns: readonly string[], rls: boolean) =>
	({ scope, withScope }: PluginClientExtensionContext) => {
		// `null` marks a `$withoutTenant()` client; it starts from no values.
		const current = (scope ?? EMPTY) as TenantState;

		const $tenant = (values: Record<string, unknown>) => {
			if (typeof values !== 'object' || values === null)
				throw invalid('$tenant() expects an object of tenant values.');

			const next: Record<string, unknown> = { ...current };
			let size = 0;
			for (const key in values) {
				if (!columns.includes(key))
					throw invalid(
						`$tenant(): "${key}" is not a tenant column; expected one of ${columns.map((column) => `"${column}"`).join(', ')}.`,
						{ column: key },
					);
				const value = values[key];
				if (value === undefined || value === null)
					throw invalid(`$tenant(): "${key}" must not be ${value}.`, {
						column: key,
					});
				if (rls && value === '')
					throw invalid(
						`$tenant(): "${key}" must not be empty when RLS is enabled.`,
						{ column: key },
					);
				if (current[key] !== undefined)
					throw new BetterDrizzleError({
						code: BetterDrizzleErrorCode.TenantAlreadyScoped,
						column: key,
						details: { pluginId: PLUGIN_ID },
						message: `$tenant(): "${key}" is already set on this client.`,
					});
				next[key] = value;
				size++;
			}
			if (!size) throw invalid('$tenant() expects at least one value.');

			return withScope(
				Object.freeze(next),
				scope === null ? { tenantBypass: undefined } : undefined,
			);
		};

		return {
			$tenant: Object.assign($tenant, { values: current }),
			$withoutTenant: (options: { reason: string }) => {
				const reason = (options as { reason?: unknown } | undefined)
					?.reason;
				if (typeof reason !== 'string' || !reason.trim())
					throw invalid(
						'$withoutTenant() requires a non-empty `reason` string.',
					);
				return withScope(null, { tenantBypass: { reason } });
			},
		};
	};
