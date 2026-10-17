import type {
	AdapterFactoryCustomizeAdapterCreator,
	CleanedWhere,
	CustomAdapter,
} from 'better-auth/adapters';
import type { TableRuntime } from 'better-drizzle';

import { invalid } from './errors';
import { applyJoins, renameJoins } from './joins';
import { createSchema } from './schema';
import {
	type AdapterState,
	type Client,
	type Delegate,
	type Row,
	getColumn,
	primaryKeyWhere,
	resolveTable,
} from './state';
import { EVERY_ROW, toWhere } from './where';

type CreatorHelpers = Parameters<AdapterFactoryCustomizeAdapterCreator>[0];
type Method<Name extends keyof CustomAdapter> = CustomAdapter[Name] extends
	| ((args: infer Args) => unknown)
	| undefined
	? Args
	: never;

/** Each Better Auth call is one delegate call on `client`, the root or a transaction client. */
export const createMethods = (
	state: AdapterState,
	client: Client,
	{ getFieldName, options }: CreatorHelpers,
): CustomAdapter => {
	const { dialect, readArgs } = state;

	const table = (model: string) => {
		const { key, runtime } = resolveTable(state, model);
		return { key, repo: client[key] as Delegate, runtime };
	};

	const where = (
		runtime: TableRuntime,
		model: string,
		list: CleanedWhere[] | undefined,
	) => toWhere(runtime, model, list, dialect);

	/** `select` and `sortBy` carry Better Auth field names; `where` and `data` are already mapped. */
	const fieldKey = (
		runtime: TableRuntime,
		model: string,
		modelKey: string,
		field: string,
	) => {
		const key = getFieldName({ field, model: modelKey });
		getColumn(runtime, model, key);
		return key;
	};

	const select = (
		runtime: TableRuntime,
		model: string,
		modelKey: string,
		fields: string[] | undefined,
	) => {
		if (!fields?.length) return undefined;

		const result = Object.create(null) as Row;
		for (const field of fields)
			result[fieldKey(runtime, model, modelKey, field)] = true;

		return result;
	};

	const countSelect = (runtime: TableRuntime) => {
		const [key] = runtime.primaryKeyFields;
		return key === undefined ? undefined : { [key]: true };
	};

	/**
	 * MySQL has no RETURNING: lock the first matching row, then write it by
	 * primary key, so concurrent callers cannot both claim it.
	 */
	const lockedWrite = <T>(
		key: string,
		runtime: TableRuntime,
		filter: Row | undefined,
		write: (repo: Delegate, where: Row, row: Row) => Promise<T>,
	) => {
		if (!runtime.primaryKeyFields.length)
			throw invalid(
				`The "${key}" table needs a primary key for atomic writes on MySQL.`,
				key,
			);

		return client.transaction(async (tx) => {
			const repo = tx[key] as Delegate;
			const row = (await repo.findFirst!({
				lock: 'update',
				where: filter,
			})) as Row | null;
			if (!row) return null;

			return write(repo, primaryKeyWhere(runtime, row), row);
		});
	};

	return {
		async create({ model, modelKey = model, data, select: fields }) {
			const { repo, runtime } = table(model);
			for (const field in data) getColumn(runtime, model, field);

			return (await repo.create!({
				data,
				select: select(runtime, model, modelKey, fields),
			})) as typeof data;
		},

		async findOne<T>({
			model,
			modelKey = model,
			where: list,
			select: fields,
			join,
		}: Method<'findOne'>) {
			const { repo, runtime } = table(model);
			const args: Row = {
				...readArgs,
				select: select(runtime, model, modelKey, fields),
				where: where(runtime, model, list),
			};
			const joins = applyJoins(state, args, model, runtime, join);

			return renameJoins(
				(await repo.findFirst!(args)) as Row | null,
				joins,
			) as T | null;
		},

		async findMany<T>({
			model,
			modelKey = model,
			where: list,
			limit,
			offset,
			select: fields,
			sortBy,
			join,
		}: Method<'findMany'>) {
			const { repo, runtime } = table(model);
			const args: Row = {
				...readArgs,
				select: select(runtime, model, modelKey, fields),
				skip: offset,
				take: limit,
				where: where(runtime, model, list),
			};
			if (sortBy)
				args.orderBy = {
					[fieldKey(runtime, model, modelKey, sortBy.field)]:
						sortBy.direction,
				};
			const joins = applyJoins(state, args, model, runtime, join);

			const rows = (await repo.findMany!(args)) as Row[];
			if (joins) for (const row of rows) renameJoins(row, joins);

			return rows as T[];
		},

		async count({ model, where: list }) {
			const { repo, runtime } = table(model);

			return (await repo.count!({
				...readArgs,
				where: where(runtime, model, list),
			})) as number;
		},

		async update<T>({ model, where: list, update }: Method<'update'>) {
			const { repo, runtime } = table(model);

			return (await repo.update!({
				data: update,
				where: where(runtime, model, list),
			})) as T | null;
		},

		async updateMany({ model, where: list, update }) {
			const { repo, runtime } = table(model);
			const { count } = (await repo.updateMany!({
				data: update,
				select: countSelect(runtime),
				where: where(runtime, model, list) ?? EVERY_ROW,
			})) as { count: number };

			return count;
		},

		// No `select`: core `delete` with a projection reloads the deleted row.
		async delete({ model, where: list }) {
			const { repo, runtime } = table(model);
			await repo.delete!({ where: where(runtime, model, list) });
		},

		async deleteMany({ model, where: list }) {
			const { repo, runtime } = table(model);
			const { count } = (await repo.deleteMany!({
				select: countSelect(runtime),
				where: where(runtime, model, list) ?? EVERY_ROW,
			})) as { count: number };

			return count;
		},

		async consumeOne<T>({ model, where: list }: Method<'consumeOne'>) {
			const { key, repo, runtime } = table(model);
			const filter = where(runtime, model, list);
			if (dialect !== 'mysql')
				return (await repo.delete!({ where: filter })) as T | null;

			return lockedWrite(key, runtime, filter, async (tx, byKey, row) => {
				await tx.delete!({ where: byKey });
				return row as T;
			});
		},

		async incrementOne<T>({
			model,
			where: list,
			increment,
			set,
		}: Method<'incrementOne'>) {
			const { key, repo, runtime } = table(model);
			const data = Object.create(null) as Row;
			for (const field in set) {
				getColumn(runtime, model, field);
				data[field] = set[field];
			}
			for (const field in increment) {
				getColumn(runtime, model, field);
				data[field] = { increment: increment[field] };
			}

			// `where` is also the guard; PostgreSQL and SQLite recheck it in the UPDATE.
			const filter = where(runtime, model, list);
			if (dialect !== 'mysql')
				return (await repo.update!({
					data,
					where: filter,
				})) as T | null;

			return lockedWrite(
				key,
				runtime,
				filter,
				async (tx, byKey) =>
					(await tx.update!({ data, where: byKey })) as T | null,
			);
		},

		createSchema: ({ file }) => createSchema(state, options, file),

		options: {
			...state.options,
			provider: dialect,
			usePlural: state.usePlural,
		},
	};
};
