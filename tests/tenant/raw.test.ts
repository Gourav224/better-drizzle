import { describe, expect, test } from 'bun:test';

import { sql } from 'drizzle-orm';

import { createTenantDb } from './fixture';

const rejects = (operation: unknown) =>
	expect(Promise.resolve(operation)).rejects;

const setup = (raw?: 'allow' | 'deny') => {
	const queries: string[] = [];
	const seen: unknown[] = [];
	const { db } = createTenantDb(raw ? { raw } : {}, {
		hooks: {
			beforeRaw: (context: { rawOptions: { tenant?: unknown } }) => {
				seen.push(context.rawOptions.tenant);
			},
		},
		queries,
		raw: { allowUnsafe: true },
	});
	return { db, queries, scoped: db.$tenant({ organizationId: 'a' }), seen };
};

describe('tenant raw SQL', () => {
	test('TEN-32: raw calls on a scoped client are denied before SQL runs', async () => {
		const { queries, scoped } = setup();

		await rejects(scoped.$raw`select 1`).toMatchObject({
			code: 'TENANT_RAW_DENIED',
			status: 403,
		});
		await rejects(scoped.$raw(sql`select 1`)).toMatchObject({
			code: 'TENANT_RAW_DENIED',
		});
		await rejects(
			scoped.$executeRaw(sql`update t_projects set name = 'x'`),
		).toMatchObject({ code: 'TENANT_RAW_DENIED' });
		await rejects(scoped.$rawUnsafe('select 1')).toMatchObject({
			code: 'TENANT_RAW_DENIED',
		});
		expect(queries).toEqual([]);
	});

	test('TEN-32: unscoped and bypass clients keep raw SQL', async () => {
		const { db } = setup();

		expect(
			await db.$raw(sql`select count(*) as n from t_projects`),
		).toEqual([{ n: 3 }]);
		expect(
			await db
				.$withoutTenant({ reason: 'report' })
				.$raw(sql`select count(*) as n from t_projects`),
		).toEqual([{ n: 3 }]);
	});

	test('TEN-33: the per-call opt-in runs and reaches raw hooks', async () => {
		const { scoped, seen } = setup();

		expect(
			await scoped.$raw(sql`select count(*) as n from t_projects`, {
				tenant: 'trusted',
			}),
		).toEqual([{ n: 3 }]);
		expect(
			await scoped.$executeRaw(sql`update t_plans set name = name`, {
				tenant: 'trusted',
			}),
		).toEqual({ rowsAffected: 2 });
		expect(
			await scoped.$rawUnsafe('select 1 as one', undefined, {
				tenant: 'trusted',
			}),
		).toEqual([{ one: 1 }]);
		expect(seen).toEqual(['trusted', 'trusted', 'trusted']);
	});

	test("TEN-34: `raw: 'allow'` runs raw calls unchanged", async () => {
		const { scoped } = setup('allow');

		expect(
			await scoped.$raw(sql`select count(*) as n from t_projects`),
		).toEqual([{ n: 3 }]);
		expect(await scoped.$rawUnsafe('select 1 as one')).toEqual([
			{ one: 1 },
		]);
	});
});
