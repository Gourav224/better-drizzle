import { customType } from 'drizzle-orm/mysql-core';

import {
	BINARY_UUID,
	forJsonSelect,
	fromBytes,
	fromHex,
	toBytes,
} from './shared/binary';

const params = {
	dataType: () => 'binary(16)',
	forJsonSelect,
	fromDriver: fromBytes,
	fromJson: fromHex,
	toDriver: toBytes,
	[BINARY_UUID]: true,
};

/**
 * MySQL `binary(16)` UUID column typed as `string`. Values are written and
 * filtered as hyphenated strings and stored as 16 bytes; `uuids()` fills it
 * like any string id column.
 *
 * @example
 * ```ts
 * import { buuid } from 'better-drizzle/uuid/mysql';
 *
 * export const users = mysqlTable('users', {
 *   id: buuid('id').primaryKey(),
 * });
 * ```
 */
export const buuid = customType<{
	data: string;
	driverData: Buffer;
	jsonData: string;
}>(params);
