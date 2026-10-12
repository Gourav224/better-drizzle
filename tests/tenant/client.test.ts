import { describe, expect, test } from 'bun:test';

import { createTenantDb, ids } from './fixture';

const codeOf = (run: () => unknown) => {
	try {
		run();
	} catch (error) {
		return (error as { code?: string }).code;
	}
	return 'no error';
};

describe('$tenant', () => {
	test('TEN-06: returns a scoped client and leaves the original unscoped', async () => {
		const { db } = createTenantDb();
		const scoped = db.$tenant({ organizationId: 'b' });

		expect(ids(await scoped.projects.findMany())).toEqual([3]);
		await expect(
			Promise.resolve(db.projects.findMany()),
		).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
		expect(db.$tenant.values).toEqual({});
	});

	test('TEN-07: rejects empty objects, unknown keys, and null values', () => {
		const { db } = createTenantDb();

		expect(codeOf(() => db.$tenant({}))).toBe('INVALID_ARGS');
		expect(codeOf(() => db.$tenant({ tenantId: 'a' } as never))).toBe(
			'INVALID_ARGS',
		);
		expect(
			codeOf(() => db.$tenant({ organizationId: null } as never)),
		).toBe('INVALID_ARGS');
		expect(codeOf(() => db.$tenant({ organizationId: undefined }))).toBe(
			'INVALID_ARGS',
		);
	});

	test('an empty string remains a valid tenant value without RLS', async () => {
		const { db } = createTenantDb();
		expect(
			ids(await db.$tenant({ organizationId: '' }).projects.findMany()),
		).toEqual([]);
	});

	test('TEN-08: narrows a scoped client with columns not set yet', async () => {
		const { db } = createTenantDb();
		const narrowed = db
			.$tenant({ organizationId: 'a' })
			.$tenant({ workspaceId: 2 });

		expect(ids(await narrowed.tasks.findMany())).toEqual([2]);
		expect(ids(await narrowed.projects.findMany())).toEqual([1, 2]);
	});

	test('TEN-09: setting a set column throws TENANT_ALREADY_SCOPED', () => {
		const { db } = createTenantDb();
		const scoped = db.$tenant({ organizationId: 'a' });

		expect(codeOf(() => scoped.$tenant({ organizationId: 'b' }))).toBe(
			'TENANT_ALREADY_SCOPED',
		);
		expect(codeOf(() => scoped.$tenant({ organizationId: 'a' }))).toBe(
			'TENANT_ALREADY_SCOPED',
		);
	});

	test('TEN-13: $tenant.values returns the active values', () => {
		const { db } = createTenantDb();
		const scoped = db.$tenant({ organizationId: 'a' });

		expect(scoped.$tenant.values).toEqual({ organizationId: 'a' });
		expect(scoped.$tenant({ workspaceId: 1 }).$tenant.values).toEqual({
			organizationId: 'a',
			workspaceId: 1,
		});
	});

	test('SCOPE-11: transactions inherit the tenant', async () => {
		const { db } = createTenantDb();
		const scoped = db.$tenant({ organizationId: 'a' });

		const result = await scoped.transaction(async (tx) => ({
			projects: ids(await tx.projects.findMany()),
			values: tx.$tenant.values,
		}));
		expect(result).toEqual({
			projects: [1, 2],
			values: { organizationId: 'a' },
		});
	});
});

describe('$withoutTenant', () => {
	test('per-call metadata cannot replace the recorded bypass reason', async () => {
		const observed: unknown[] = [];
		const { db } = createTenantDb(
			{},
			{
				hooks: {
					beforeQuery: (context: {
						meta?: Record<string, unknown>;
					}) => {
						observed.push(context.meta?.tenantBypass);
					},
				},
			},
		);
		const bypass = db.$withoutTenant({ reason: 'audit job' });
		const forged = { tenantBypass: { reason: 'forged' } };

		await bypass.projects.findMany({ meta: forged as never });
		await bypass.$withContext(forged as never).projects.findMany();
		await bypass.transaction(
			async (tx) => {
				await tx.projects.findMany();
			},
			{ meta: forged as never },
		);

		expect(observed).toEqual([
			{ reason: 'audit job' },
			{ reason: 'audit job' },
			{ reason: 'audit job' },
		]);
	});

	test('rescoping a bypassed client clears its bypass audit marker', async () => {
		const observed: unknown[] = [];
		const { db } = createTenantDb(
			{},
			{
				hooks: {
					beforeQuery: (context: {
						meta?: Record<string, unknown>;
					}) => {
						observed.push(context.meta?.tenantBypass);
					},
				},
			},
		);
		const scoped = db
			.$withoutTenant({ reason: 'audit job' })
			.$tenant({ organizationId: 'a' });

		expect(ids(await scoped.projects.findMany())).toEqual([1, 2]);
		await scoped.projects.findMany({
			meta: { tenantBypass: { reason: 'forged' } } as never,
		});
		expect(observed).toEqual([undefined, undefined]);
	});

	test('TEN-26: reads every tenant and passes meta.tenantBypass to hooks', async () => {
		const metas: unknown[] = [];
		const { db } = createTenantDb(
			{},
			{
				hooks: {
					beforeQuery: (context: {
						meta?: Record<string, unknown>;
					}) => {
						metas.push(context.meta?.tenantBypass);
					},
				},
			},
		);
		const bypass = db.$withoutTenant({ reason: 'nightly job' });

		expect(ids(await bypass.projects.findMany())).toEqual([1, 2, 3]);
		expect(ids(await bypass.tasks.findMany())).toEqual([1, 2, 3]);
		expect(metas).toEqual([
			{ reason: 'nightly job' },
			{ reason: 'nightly job' },
		]);
		expect(bypass.$tenant.values).toEqual({});
	});

	test('TEN-27: `reason` must be a non-empty string', () => {
		const { db } = createTenantDb();

		expect(codeOf(() => db.$withoutTenant({ reason: '' }))).toBe(
			'INVALID_ARGS',
		);
		expect(codeOf(() => db.$withoutTenant({ reason: '  ' }))).toBe(
			'INVALID_ARGS',
		);
		expect(codeOf(() => db.$withoutTenant({} as never))).toBe(
			'INVALID_ARGS',
		);
		expect(codeOf(() => db.$withoutTenant(undefined as never))).toBe(
			'INVALID_ARGS',
		);
	});
});
