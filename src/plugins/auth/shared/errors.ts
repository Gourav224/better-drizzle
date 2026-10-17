import type { CustomAdapter } from 'better-auth/adapters';
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

export const invalid = (
	message: string,
	table?: string,
	details?: Record<string, unknown>,
) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.InvalidArgs,
		details,
		message: `[better-drizzle/auth] ${message}`,
		table,
	});

/** Driver failures reach Better Auth as `BetterDrizzleError`, as on a client with hooks. */
const normalizeError = (error: unknown, operation: string, table: string) =>
	BetterDrizzleError.is(error)
		? error
		: BetterDrizzleError.from(error, { operation, table });

const OPERATIONS = [
	'create',
	'findOne',
	'findMany',
	'count',
	'update',
	'updateMany',
	'delete',
	'deleteMany',
	'consumeOne',
	'incrementOne',
] as const;

/** Wraps every adapter operation so its failures go through {@link normalizeError}. */
export const withNormalizedErrors = (methods: CustomAdapter) => {
	const wrapped = methods as unknown as Record<
		string,
		(args: { model: string }) => Promise<unknown>
	>;
	for (const name of OPERATIONS) {
		const method = wrapped[name];
		if (!method) continue;

		wrapped[name] = async (args) => {
			try {
				return await method(args);
			} catch (error) {
				throw normalizeError(error, name, args.model);
			}
		};
	}

	return methods;
};
