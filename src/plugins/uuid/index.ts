import {
	definePlugin,
	type PluginGeneratedColumns,
	type PluginModelInfo,
} from 'better-drizzle';
import type { AnyColumn } from 'drizzle-orm';

import { isBinaryUuid } from './shared/binary';
import { uuidv4, uuidv7 } from './shared/generate';
import type { UuidsOptions } from './types';
import { version } from './version';

type MutableRecord = Record<string, unknown>;

const DEFAULT_COLUMN = 'id';

const isRecord = (value: unknown): value is MutableRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// Plain text (`text`, `varchar`, `char`) or native `uuid`; not string-mode
// bigint, numeric, enum, binary, or date columns.
const accepts = (column: AnyColumn) =>
	column.dataType === 'string' ||
	column.dataType === 'string uuid' ||
	isBinaryUuid(column);

/**
 * Fills UUID id columns on create.
 *
 * Every model with the configured column (`id` by default) as a string or
 * `buuid()` column gets a UUID whenever the value is `undefined` in:
 * - `create` / `createMany`
 * - the `create` branch of `upsert`
 * - `upsertMany` rows; `update: 'all'` and column lists never update the
 *   column on conflict
 *
 * Explicit values always win. The column becomes optional in the create input
 * types, and the `zod` / `ata` plugins treat it as optional in create schemas
 * regardless of plugin order.
 *
 * @param options - Column name, per-model overrides, and UUID version.
 * @returns A Better Drizzle plugin definition.
 */
export const uuids = <
	const Column extends string = 'id',
	const Models extends Readonly<Record<string, string | false>> = Record<
		never,
		never
	>,
>(
	options: UuidsOptions<Column, Models> = {},
) => {
	const column = options.column ?? DEFAULT_COLUMN;
	const generate = options.version === 4 ? uuidv4 : uuidv7;

	const plugin = definePlugin({
		description: 'Fills UUID id columns on create.',
		generated: { accepts, column, models: options.models },
		id: 'better-drizzle/uuid',
		name: 'UUIDs',
		options,
		setup({ addHook, models }) {
			const byModel = Object.create(null) as Record<string, string>;
			for (const name in models) {
				const model = models[name] as PluginModelInfo;
				const override = (
					options.models as Record<string, string | false> | undefined
				)?.[name];
				if (override === false) continue;

				const key = override ?? column;
				const target = model.columns[key];
				// `generated` merges every plugin; fill only columns this plugin accepts.
				if (target && accepts(target) && model.generated.includes(key))
					byModel[name] = key;
			}

			const fill = (row: unknown, key: string) => {
				if (!isRecord(row) || row[key] !== undefined) return row;
				return { ...row, [key]: generate() };
			};

			addHook({
				beforeCreate(operation) {
					const key = byModel[operation.model.name];
					if (!key) return operation.data;

					const data = operation.data as unknown;

					if (operation.kind === 'create')
						return fill(data, key) as never;

					if (operation.kind === 'upsert') {
						if (!isRecord(data) || !isRecord(data.create))
							return operation.data;
						if (data.create[key] !== undefined)
							return operation.data;

						// A `where` that pins the id inserts that id, keeping the
						// native conflict path and the row the caller asked for.
						const pinned = (operation.args as { where?: unknown })
							.where;
						const value =
							isRecord(pinned) && typeof pinned[key] === 'string'
								? pinned[key]
								: generate();
						return {
							...data,
							create: { ...data.create, [key]: value },
						} as never;
					}

					if (!Array.isArray(data)) return operation.data;

					let rows: unknown[] | undefined;
					for (let index = 0; index < data.length; index += 1) {
						const row = fill(data[index], key);
						if (row === data[index]) continue;
						rows ??= data.slice();
						rows[index] = row;
					}

					// The id is insert-only: conflicts never overwrite it.
					const args = operation.args as {
						target?: string | readonly string[];
						update?: unknown;
					};
					if (operation.kind === 'upsertMany') {
						const targets =
							typeof args.target === 'string'
								? [args.target]
								: (args.target ?? []);
						if (args.update === 'all' && !targets.includes(key))
							args.update = Object.keys(
								operation.model.columns,
							).filter(
								(name) =>
									name !== key && !targets.includes(name),
							);
						else if (
							Array.isArray(args.update) &&
							args.update.includes(key)
						)
							args.update = args.update.filter(
								(name) => name !== key,
							);
					}

					return (rows ?? operation.data) as never;
				},
			});
		},
		version,
	});

	// NoInfer: inside `better(db, { plugins: [uuids()] })` the expected
	// `AnyPlugin` would otherwise infer `Column` as `string` and drop the types.
	return plugin as NoInfer<
		Omit<typeof plugin, 'generated'> & {
			generated: PluginGeneratedColumns<Column, Models, string>;
		}
	>;
};

export default uuids;

export { uuidv4, uuidv7 } from './shared/generate';
export type { UuidsOptions, UuidVersion } from './types';
export { version };
