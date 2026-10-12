import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	type PluginModelInfo,
} from 'better-drizzle';
import { type SQL, sql } from 'drizzle-orm';

import type { TenantOptions } from '../types';

const invalidSetting = (message: string, column: string) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.InvalidArgs,
		details: { column, pluginId: 'better-drizzle/tenant' },
		message,
	});

/**
 * Setting name per tenant column: `rls.settings[column]`, else
 * `app.<database column name>` from the first model that has the column.
 */
export const resolveSettings = (
	options: TenantOptions,
	columns: readonly string[],
	models: Readonly<Record<string, PluginModelInfo>>,
) => {
	const custom =
		typeof options.rls === 'object'
			? (options.rls.settings as Readonly<Record<string, unknown>>)
			: undefined;
	if (custom)
		for (const key in custom) {
			if (!columns.includes(key))
				throw invalidSetting(
					`RLS setting for unknown tenant column "${key}".`,
					key,
				);
			if (typeof custom[key] !== 'string' || !custom[key].trim())
				throw invalidSetting(
					`RLS setting for "${key}" must be a non-empty name.`,
					key,
				);
		}
	const settings = Object.create(null) as Record<string, string>;
	const used = new Set<string>();
	for (const key of columns) {
		const setting = custom?.[key] as string | undefined;
		if (setting) {
			settings[key] = setting;
		} else {
			for (const name in models) {
				const column = (models[name] as PluginModelInfo).columns[key];
				if (!column) continue;
				settings[key] = `app.${column.name}`;
				break;
			}
			settings[key] ??= `app.${key}`;
		}
		if (used.has(settings[key]))
			throw invalidSetting(
				`RLS setting "${settings[key]}" is assigned to more than one tenant column.`,
				key,
			);
		used.add(settings[key]);
	}
	return settings;
};

/**
 * `set_config(setting, value, true)` for every configured tenant column.
 * An omitted column is cleared so a prior scope in the same transaction
 * cannot leave a stale RLS setting behind. PostgreSQL resets custom settings
 * to an empty string, so RLS policies must treat that value as absent.
 */
export const rlsSession =
	(settings: () => Readonly<Record<string, string>>) =>
	(state: Readonly<Record<string, unknown>> | null): SQL[] | undefined => {
		const names = settings();
		let statements: SQL[] | undefined;
		for (const key in names) {
			const value = state?.[key];
			(statements ??= []).push(
				sql`select set_config(${names[key]}, ${value === undefined || value === null ? '' : String(value)}, true)`,
			);
		}
		return statements;
	};
