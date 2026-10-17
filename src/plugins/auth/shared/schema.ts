import type { BetterAuthOptions } from 'better-auth';
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

import type { AdapterState } from './state';

/** `npx auth generate` uses the official Drizzle ORM 1.x generator. */
export const createSchema = async (
	state: AdapterState,
	options: BetterAuthOptions,
	file?: string,
) => {
	let official: typeof import('@better-auth/drizzle-adapter/relations-v2');
	try {
		official = await import('@better-auth/drizzle-adapter/relations-v2');
	} catch (cause) {
		throw new BetterDrizzleError({
			cause,
			code: BetterDrizzleErrorCode.OperationError,
			message:
				'[better-drizzle/auth] Schema generation needs @better-auth/drizzle-adapter. Install it as a dev dependency.',
		});
	}

	const instance = official.drizzleAdapter(state.context.db, {
		camelCase: state.options.camelCase,
		provider: state.dialect,
		schemaName: state.options.schemaName,
		usePlural: state.usePlural,
	})(options);

	return instance.createSchema!(options, file);
};
