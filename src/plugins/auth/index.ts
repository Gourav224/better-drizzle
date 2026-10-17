import {
	type AdapterFactoryCustomizeAdapterCreator,
	createAdapterFactory,
} from 'better-auth/adapters';

import { createConfig, inspectAuthTables } from './shared/config';
import { withNormalizedErrors } from './shared/errors';
import { createMethods } from './shared/methods';
import { type AdapterState, type Client, createState } from './shared/state';
import type { AuthAdapterOptions } from './types';
import { version } from './version';

const createCustomAdapter =
	(
		state: AdapterState,
		client: Client,
	): AdapterFactoryCustomizeAdapterCreator =>
	(helpers) => {
		inspectAuthTables(state, helpers);

		return withNormalizedErrors(createMethods(state, client, helpers));
	};

/**
 * Better Auth database adapter backed by a Better Drizzle client, so auth
 * reads and writes run through the client's plugins, hooks, scopes, and
 * error normalization.
 *
 * ```ts
 * export const auth = betterAuth({ database: adapter(db) });
 * ```
 *
 * The provider comes from the client's dialect and the tables and relations
 * from `drizzle({ relations })`, so no `provider` or `schema` option exists.
 *
 * @param db - The Better Drizzle client (`better(drizzle(...))`).
 * @param options - Adapter options.
 * @returns The `database` value for `betterAuth()`.
 */
export const adapter = (db: object, options: AuthAdapterOptions = {}) => {
	const state = createState(db, options);
	const config = createConfig(state);

	if (options.transaction !== false)
		config.transaction = (callback) =>
			state.root.transaction((tx) =>
				callback(
					createAdapterFactory({
						adapter: createCustomAdapter(state, tx),
						config: { ...config, transaction: false },
					})(state.authOptions!),
				),
			);

	return createAdapterFactory({
		adapter: createCustomAdapter(state, state.root),
		config,
	});
};

/** Alias of {@link adapter}. */
export const betterDrizzleAdapter = adapter;

export default adapter;

export type { AuthAdapterOptions } from './types';
export { version };
