import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { drizzle } from 'drizzle-orm/bun-sqlite';

import { BetterDrizzleError, better } from '../../src';
import { ata } from '../../src/plugins/ata';
import { tenant } from '../../src/plugins/tenant';
import { zod } from '../../src/plugins/zod';
import { BASE_OPTIONS, DDL, createTenantDb, ids, relations } from './fixture';

const build = (options: Record<string, unknown>, plugins: unknown[] = []) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(DDL);
	return better(drizzle({ client: sqlite, relations }), {
		plugins: [tenant(options as never), ...(plugins as never[])],
	});
};

const errorOf = (run: () => unknown) => {
	try {
		run();
	} catch (error) {
		return error as BetterDrizzleError;
	}
	throw new Error('expected a throw');
};

describe('tenant bootstrap', () => {
	test('rejects empty and duplicate tenant column configurations', () => {
		for (const columns of [[], '', ['organizationId', 'organizationId']]) {
			const error = errorOf(() => build({ ...BASE_OPTIONS, columns }));
			expect(error.code).toBe('INVALID_ARGS');
		}
	});

	test('TEN-01: a string `columns` is a one-column list', async () => {
		const db = build({
			columns: 'organizationId',
			global: ['organizations', 'plans', 'boards'],
			models: BASE_OPTIONS.models,
		});
		const scoped = db.$tenant({ organizationId: 'a' });

		expect(ids(await scoped.projects.findMany())).toEqual([1, 2]);
		// Tasks also have `workspaceId`, but only `organizationId` is configured.
		expect(ids(await scoped.tasks.findMany())).toEqual([1, 2]);
	});

	test('TEN-02: each model is scoped by the configured columns it has', async () => {
		const { db } = createTenantDb();
		const org = db.$tenant({ organizationId: 'a' });

		expect(ids(await org.workspaces.findMany())).toEqual([1, 2]);
		await expect(
			Promise.resolve(org.tasks.findMany()),
		).rejects.toMatchObject({ code: 'TENANT_REQUIRED', table: 'tasks' });
		const workspace = org.$tenant({ workspaceId: 1 });
		expect(ids(await workspace.tasks.findMany())).toEqual([1]);
		// EDGE-05: `workspaceId` is stored as `ws_id` on boards.
		expect(
			ids(await db.$tenant({ workspaceId: 3 }).boards.findMany()),
		).toEqual([2]);
	});

	test('TEN-03: a model without tenant columns must be global', () => {
		const error = errorOf(() =>
			build({ ...BASE_OPTIONS, global: ['plans'] }),
		);
		expect(error).toBeInstanceOf(BetterDrizzleError);
		expect(error.code).toBe('PLUGIN_REQUIRED_COLUMN_MISSING');
		expect(error.table).toBe('organizations');
		expect(error.message).toContain('"organizations"');
	});

	test('TEN-03: a junction between scoped models inherits their scope', async () => {
		const { db } = createTenantDb();
		const project = await db
			.$tenant({ organizationId: 'a' })
			.projects.findUnique({
				include: { members: true },
				where: { id: 1 },
			});

		expect(ids(project?.members ?? [])).toEqual([1]);
	});

	test('TEN-03: a junction with an unscoped end is not inherited', () => {
		const error = errorOf(() =>
			build({ ...BASE_OPTIONS, models: { members: false } }),
		);
		expect(error.code).toBe('PLUGIN_REQUIRED_COLUMN_MISSING');
		expect(error.table).toBe('projectMembers');
	});

	test('TEN-03: direct access to an inherited junction needs $withoutTenant', async () => {
		const { db } = createTenantDb();

		await expect(
			Promise.resolve(
				db.$tenant({ organizationId: 'a' }).projectMembers.findMany(),
			),
		).rejects.toMatchObject({
			code: 'TENANT_REQUIRED',
			table: 'projectMembers',
		});
		expect(
			await db.$withoutTenant({ reason: 'audit' }).projectMembers.count(),
		).toBe(3);
	});

	test('TEN-04: global and `false` models are neither filtered nor stamped', async () => {
		const { db } = createTenantDb({
			models: { templates: false },
		} as never);
		const scoped = db.$tenant({ organizationId: 'a' });

		expect(ids(await scoped.plans.findMany())).toEqual([1, 2]);
		const plan = await scoped.plans.create({
			data: { id: 3, name: 'pro' },
		});
		expect(plan.organizationId).toBeNull();

		expect(ids(await scoped.templates.findMany())).toEqual([1, 2, 3]);
		const template = await scoped.templates.create({
			data: { id: 4, name: 'mine' },
		});
		expect(template.organizationId).toBeNull();
	});

	test('TEN-05: `models` names the columns of a model', async () => {
		const { db } = createTenantDb({
			models: { ...BASE_OPTIONS.models, tasks: ['organizationId'] },
		} as never);

		expect(
			ids(await db.$tenant({ organizationId: 'a' }).tasks.findMany()),
		).toEqual([1, 2]);
	});

	test('TEN-05: a named column the model lacks throws', () => {
		const error = errorOf(() =>
			build({ ...BASE_OPTIONS, models: { projects: ['workspaceId'] } }),
		);
		expect(error.code).toBe('PLUGIN_REQUIRED_COLUMN_MISSING');
		expect(error.table).toBe('projects');
		expect(error.column).toBe('workspaceId');
	});

	test('TEN-15: zod and ata create schemas treat tenant columns as optional', async () => {
		const withZod = build(BASE_OPTIONS, [zod()]);
		expect(
			withZod.projects.$zod.create.safeParse({ id: 9, name: 'z' })
				.success,
		).toBe(true);
		expect(
			withZod.workspaces.$zod.create.safeParse({ id: 9 }).success,
		).toBe(false);
		const viaZod = await withZod
			.$tenant({ organizationId: 'a' })
			.projects.create({ data: { id: 9, name: 'z' } });
		expect(viaZod.organizationId).toBe('a');

		const withAta = build(BASE_OPTIONS, [ata()]);
		const viaAta = await withAta
			.$tenant({ organizationId: 'b' })
			.projects.create({ data: { id: 9, name: 'a' } });
		expect(viaAta.organizationId).toBe('b');
	});

	test('TEN-30: `strict` with `missing: allow` is rejected', () => {
		const error = errorOf(() =>
			build({ ...BASE_OPTIONS, missing: 'allow', strict: true }),
		);
		expect(error.code).toBe('INVALID_ARGS');
	});

	test('TEN-39: `rls` outside PostgreSQL is rejected', () => {
		const error = errorOf(() => build({ ...BASE_OPTIONS, rls: true }));
		expect(error.code).toBe('PLUGIN_DIALECT_UNSUPPORTED');
	});

	test('TEN-40: `raw: set-local` without `rls` is rejected', () => {
		const error = errorOf(() =>
			build({ ...BASE_OPTIONS, raw: 'set-local' }),
		);
		expect(error.code).toBe('INVALID_ARGS');
	});
});
