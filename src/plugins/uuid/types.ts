/**
 * UUID version written by {@link uuids}.
 *
 * - `7`: time-ordered (RFC 9562), monotonic within the process.
 * - `4`: random, through `crypto.randomUUID()`.
 */
export type UuidVersion = 4 | 7;

/**
 * Configuration accepted by {@link uuids}.
 */
export type UuidsOptions<
	Column extends string = 'id',
	Models extends Readonly<Record<string, string | false>> = Record<
		never,
		never
	>,
> = {
	/**
	 * Column key filled on every model that has it as a string or `buuid()`
	 * column. Models where it is missing or not a string are skipped.
	 *
	 * @default 'id'
	 */
	column?: Column;
	/**
	 * Overrides keyed by table key: a column key, or `false` to skip the
	 * model. Overridden columns must exist and be string or `buuid()` columns.
	 */
	models?: Models;
	/**
	 * UUID version to generate.
	 *
	 * @default 7
	 */
	version?: UuidVersion;
};
