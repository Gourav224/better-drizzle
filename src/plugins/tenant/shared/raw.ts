import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

import { PLUGIN_ID, SCOPE_KEY } from './scope';

/**
 * `beforeRaw` hook of `raw: 'deny'`: raw SQL on a tenant-scoped client throws
 * unless the call passes `{ tenant: 'trusted' }`.
 */
export const denyRaw = (context: {
	action: string;
	rawOptions: { tenant?: unknown };
	scopes: Readonly<Record<string, unknown>> | undefined;
}) => {
	const state = context.scopes?.[SCOPE_KEY];
	if (state === undefined || state === null) return;
	if (context.rawOptions.tenant === 'trusted') return;
	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.TenantRawDenied,
		details: { pluginId: PLUGIN_ID },
		message: `Raw SQL (${context.action}) is denied on a tenant-scoped client. Pass { tenant: 'trusted' } to run it, or use $withoutTenant({ reason }).`,
		operation: context.action,
	});
};
