import type { JoinConfig } from 'better-auth/adapters';
import type { TableRuntime } from 'better-drizzle';

import { invalid } from './errors';
import {
	type AdapterState,
	type ResolvedJoin,
	type Row,
	getColumn,
	resolveTable,
} from './state';

export interface AppliedJoin extends ResolvedJoin {
	/** A one-to-one join loaded through a `many` relation (unique foreign key). */
	unwrap: boolean;
}

type JoinOn = JoinConfig[string]['on'];

/** The relation whose single source and target columns match `on`. */
const findRelation = (
	state: AdapterState,
	model: string,
	runtime: TableRuntime,
	joinModel: string,
	on: JoinOn,
): ResolvedJoin => {
	const id = `${model}\0${joinModel}`;
	const cached = state.joins.get(id);
	if (cached) return cached;

	const from = getColumn(runtime, model, on.from);
	const to = getColumn(
		resolveTable(state, joinModel).runtime,
		joinModel,
		on.to,
	);
	for (const relation in runtime.relations) {
		const { fields, kind, references } = runtime.relations[
			relation
		] as TableRuntime['relations'][string];
		if (kind === 'manyToMany' || fields.length !== 1) continue;
		if (fields[0] !== from || references[0] !== to) continue;

		const join = { key: joinModel, kind, relation };
		state.joins.set(id, join);
		return join;
	}

	throw invalid(
		`No relation from "${model}" to "${joinModel}" (${model}.${on.from} = ${joinModel}.${on.to}). Add it to defineRelations() or regenerate the schema with \`npx auth generate\`.`,
		model,
		{ joinModel },
	);
};

/** Adds each join as `include` (or nested `select`) to the read args. */
export const applyJoins = (
	state: AdapterState,
	args: Row,
	model: string,
	runtime: TableRuntime,
	join: JoinConfig | undefined,
) => {
	if (!join) return undefined;

	const projection = (args.select ?? Object.create(null)) as Row;
	const applied: AppliedJoin[] = [];
	for (const joinModel in join) {
		const config = join[joinModel] as JoinConfig[string];
		const found = findRelation(state, model, runtime, joinModel, config.on);
		const unwrap =
			found.kind === 'many' && config.relation === 'one-to-one';
		projection[found.relation] =
			found.kind === 'one'
				? true
				: { take: unwrap ? 1 : (config.limit ?? 100) };
		applied.push({ ...found, unwrap });
	}

	if (args.select) args.select = projection;
	else {
		delete args.select;
		args.include = projection;
	}

	return applied;
};

/** Moves joined rows to the keys Better Auth reads. */
export const renameJoins = (
	row: Row | null,
	applied: AppliedJoin[] | undefined,
) => {
	if (!row || !applied) return row;

	for (const { key, relation, unwrap } of applied) {
		const value = row[relation];
		if (relation !== key) delete row[relation];
		row[key] = unwrap ? ((value as unknown[])[0] ?? null) : value;
	}

	return row;
};
