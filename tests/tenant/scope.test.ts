import { describe, expect, test } from 'bun:test';

import { createTenantDb, ids } from './fixture';

const rejects = (operation: unknown) =>
	expect(Promise.resolve(operation)).rejects;

describe('tenant scope', () => {
	test('TEN-10: a scoped model without a tenant throws before SQL runs', async () => {
		const queries: string[] = [];
		const { db } = createTenantDb({}, { queries });

		await rejects(db.projects.findMany()).toMatchObject({
			code: 'TENANT_REQUIRED',
			status: 403,
			table: 'projects',
		});
		await rejects(
			db.projects.create({ data: { id: 9, name: 'x' } }),
		).toMatchObject({ code: 'TENANT_REQUIRED' });
		await rejects(
			db.projects.updateMany({ data: { name: 'x' }, where: { id: 1 } }),
		).toMatchObject({ code: 'TENANT_REQUIRED' });
		expect(queries).toEqual([]);
		// Global models keep working on the root client.
		expect(ids(await db.plans.findMany())).toEqual([1, 2]);
	});

	test('TEN-10: each model requires the columns it uses (partial context)', async () => {
		const queries: string[] = [];
		const { db } = createTenantDb({}, { queries });
		const org = db.$tenant({ organizationId: 'a' });

		expect(ids(await org.projects.findMany())).toEqual([1, 2]);
		const before = queries.length;
		await rejects(org.boards.findMany()).toMatchObject({
			code: 'TENANT_REQUIRED',
			table: 'boards',
		});
		await rejects(org.tasks.count()).toMatchObject({
			code: 'TENANT_REQUIRED',
			details: expect.objectContaining({ columns: ['workspaceId'] }),
		});
		expect(queries.length).toBe(before);
	});

	test('TEN-11: `missing: allow` runs unfiltered on the missing columns', async () => {
		const { db } = createTenantDb({ missing: 'allow' });

		expect(ids(await db.projects.findMany())).toEqual([1, 2, 3]);
		// Only `organizationId` is set: tasks filter by it alone.
		expect(
			ids(await db.$tenant({ organizationId: 'a' }).tasks.findMany()),
		).toEqual([1, 2]);
	});

	test('TEN-12: nullable models match the tenant or NULL, and writes stamp it', async () => {
		const { db } = createTenantDb();
		const scoped = db.$tenant({ organizationId: 'a' });

		expect(ids(await scoped.templates.findMany())).toEqual([1, 3]);
		const created = await scoped.templates.create({
			data: { id: 4, name: 'new' },
		});
		expect(created.organizationId).toBe('a');
	});

	test('TEN-41: shared NULL rows cannot be updated, claimed, or deleted by a tenant', async () => {
		const { db, sqlite } = createTenantDb();
		const scoped = db.$tenant({ organizationId: 'a' });
		const shared = () =>
			sqlite
				.query(
					'select name, organization_id from t_templates where id = 3',
				)
				.get();

		expect(
			await scoped.templates.update({
				data: { name: 'hijacked' },
				where: { id: 3 },
			}),
		).toBeNull();
		expect(
			await scoped.templates.update({
				data: { organizationId: 'a' },
				where: { id: 3 },
			}),
		).toBeNull();
		expect(await scoped.templates.delete({ where: { id: 3 } })).toBeNull();
		expect(
			await scoped.templates.deleteMany({ where: { name: 'shared' } }),
		).toEqual({ count: 0 });
		expect(shared()).toEqual({ name: 'shared', organization_id: null });
		expect(ids(await scoped.templates.findMany())).toEqual([1, 3]);

		const bypass = db.$withoutTenant({ reason: 'curate shared rows' });
		expect(
			await bypass.templates.update({
				data: { name: 'curated' },
				where: { id: 3 },
			}),
		).toMatchObject({ name: 'curated', organizationId: null });
		expect(shared()).toEqual({ name: 'curated', organization_id: null });
	});

	test('TEN-14/16/17: creates stamp the tenant, accept equal values, reject others', async () => {
		const queries: string[] = [];
		const { db } = createTenantDb({}, { queries });
		const scoped = db.$tenant({ organizationId: 'a' });

		const stamped = await scoped.projects.create({
			data: { id: 9, name: 'stamped' },
		});
		expect(stamped.organizationId).toBe('a');
		const equal = await scoped.projects.create({
			data: { id: 10, name: 'equal', organizationId: 'a' },
		});
		expect(equal.organizationId).toBe('a');

		const before = queries.length;
		await rejects(
			scoped.projects.create({
				data: { id: 11, name: 'foreign', organizationId: 'b' },
			}),
		).toMatchObject({
			code: 'TENANT_MISMATCH',
			column: 'organizationId',
			status: 403,
			table: 'projects',
		});
		expect(queries.length).toBe(before);
	});

	test('TEN-18: updates cannot change a tenant column', async () => {
		const { db, sqlite } = createTenantDb();
		const scoped = db.$tenant({ organizationId: 'a' });

		await rejects(
			scoped.projects.update({
				data: { organizationId: 'b' },
				where: { id: 1 },
			}),
		).toMatchObject({ code: 'TENANT_MISMATCH', column: 'organizationId' });
		expect(
			sqlite
				.query('select organization_id from t_projects where id = 1')
				.get(),
		).toEqual({ organization_id: 'a' });
	});

	test('TEN-20: an upsert conflicting with another tenant throws and keeps the row', async () => {
		const { db, sqlite } = createTenantDb();

		await rejects(
			db.$tenant({ organizationId: 'a' }).projects.upsert({
				create: { id: 3, name: 'taken' },
				update: { name: 'taken' },
				where: { id: 3 },
			}),
		).toMatchObject({ code: 'TENANT_MISMATCH' });
		expect(
			sqlite
				.query(
					'select name, organization_id from t_projects where id = 3',
				)
				.get(),
		).toEqual({ name: 'b-p1', organization_id: 'b' });
	});

	test('TEN-28: $withoutPlugins() on a scoped client records the bypass', async () => {
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

		const rows = await db
			.$tenant({ organizationId: 'a' })
			.projects.$withoutPlugins()
			.findMany();
		expect(ids(rows)).toEqual([1, 2, 3]);
		await db.projects.$withoutPlugins().findMany();
		expect(metas).toEqual([{ reason: '$withoutPlugins' }, undefined]);
	});

	test('TEN-29: a strict root client still throws at runtime', async () => {
		const { db } = createTenantDb({ strict: true });
		const root = db as unknown as {
			projects: { findMany(): unknown };
		};

		await rejects(root.projects.findMany()).toMatchObject({
			code: 'TENANT_REQUIRED',
		});
		expect(
			ids(await db.$tenant({ organizationId: 'a' }).projects.findMany()),
		).toEqual([1, 2]);
	});
});
