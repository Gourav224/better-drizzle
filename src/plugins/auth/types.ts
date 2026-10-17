import type { DBAdapterDebugLogOption } from 'better-auth/adapters';

/**
 * Options accepted by {@link adapter}.
 */
export interface AuthAdapterOptions {
	/**
	 * Table keys are plural (`users` instead of `user`). Detected from the
	 * client when omitted: `true` when there is a `users` table and no `user`.
	 */
	usePlural?: boolean;
	/** Better Auth adapter debug logs. @default false */
	debugLogs?: DBAdapterDebugLogOption;
	/**
	 * Runs multi-step Better Auth writes (sign-up creates a user and an
	 * account) in one `db.transaction()`. @default true
	 */
	transaction?: boolean;
	/** Metadata merged into every adapter operation, like `$withContext()`. */
	meta?: Record<string, unknown>;
	/**
	 * Lets adapter reads use the `cache()` plugin. Writes always invalidate.
	 * @default false
	 */
	cache?: boolean;
	/**
	 * Schema generation only (`npx auth generate`): camelCase table and
	 * column names instead of snake_case. @default false
	 */
	camelCase?: boolean;
	/**
	 * Schema generation only (`npx auth generate`): PostgreSQL schema the
	 * generated tables live in.
	 */
	schemaName?: string;
}
