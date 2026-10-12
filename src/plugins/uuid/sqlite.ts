import { customType } from 'drizzle-orm/sqlite-core';

import {
	BINARY_UUID,
	forJsonSelect,
	fromBytes,
	fromHex,
	toBytes,
} from './shared/binary';

const params = {
	dataType: () => 'blob',
	forJsonSelect,
	fromDriver: fromBytes,
	fromJson: fromHex,
	toDriver: toBytes,
	[BINARY_UUID]: true,
};

/**
 * SQLite `blob` UUID column typed as `string`. Values are written and
 * filtered as hyphenated strings and stored as 16 bytes; `uuids()` fills it
 * like any string id column.
 *
 * @example
 * ```ts
 * import { buuid } from 'better-drizzle/uuid/sqlite';
 *
 * export const users = sqliteTable('users', {
 *   id: buuid('id').primaryKey(),
 * });
 * ```
 */
export const buuid = customType<{
	data: string;
	driverData: Buffer;
	driverOutput: ArrayBuffer | Uint8Array;
	jsonData: string;
}>(params);
