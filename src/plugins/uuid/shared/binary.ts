import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';
import type { AnyColumn, SQL, SQLGenerator } from 'drizzle-orm';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encodes a hyphenated UUID string as 16 bytes.
 */
export const toBytes = (value: string) => {
	if (!UUID.test(value))
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			message: `Expected a UUID string, got "${value}".`,
		});

	return Buffer.from(value.replaceAll('-', ''), 'hex');
};

/**
 * Formats 32 hex digits as a lowercase, hyphenated UUID. Drizzle's relational
 * queries select `buuid()` columns inside JSON as `hex(column)`.
 */
export const fromHex = (value: string) => {
	if (value.length !== 32)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message: `Expected 16 UUID bytes, got ${value.length / 2}.`,
		});

	const hex = value.toLowerCase();
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Decodes 16 bytes read from the driver into a lowercase, hyphenated UUID.
 */
export const fromBytes = (value: ArrayBuffer | Uint8Array) =>
	fromHex(
		(Buffer.isBuffer(value)
			? value
			: value instanceof Uint8Array
				? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
				: Buffer.from(value)
		).toString('hex'),
	);

/**
 * Selects `buuid()` columns as hex inside JSON relational queries.
 */
export const forJsonSelect = (identifier: SQL, sql: SQLGenerator) =>
	sql`hex(${identifier})`;

/**
 * Marks `buuid()` params. A registered symbol keeps the check working when
 * the uuid, zod, and ata entry points are bundled separately.
 */
export const BINARY_UUID = Symbol.for('better-drizzle/uuid/binary');

/**
 * Whether a column was declared with `buuid()`.
 */
export const isBinaryUuid = (column: AnyColumn) =>
	(
		column as unknown as {
			config?: { customTypeParams?: { [BINARY_UUID]?: true } };
		}
	).config?.customTypeParams?.[BINARY_UUID] === true;
