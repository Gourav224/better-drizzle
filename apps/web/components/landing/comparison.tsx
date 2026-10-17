import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

const COLUMNS = ['better-drizzle', 'Drizzle', 'Prisma'] as const;

const ROWS: { label: string; values: [string, string, string] }[] = [
	{
		label: 'Schema',
		values: [
			'Your Drizzle tables',
			'TypeScript tables',
			'schema.prisma + generate',
		],
	},
	{
		label: 'Nested relations',
		values: [
			'include / select, batched',
			'db.query or manual joins',
			'include / select',
		],
	},
	{
		label: 'Relation filters',
		values: [
			'some, every, none, is',
			'exists by hand',
			'some, every, none, is',
		],
	},
	{
		label: 'Pagination metadata',
		values: ['paginate(), cursor()', 'by hand', 'skip / take + count'],
	},
	{
		label: 'Relation writes',
		values: [
			'connect, disconnect, set',
			'junction rows by hand',
			'nested writes',
		],
	},
	{
		label: 'Bulk upserts',
		values: [
			'upsertMany, updateEach',
			'insert builders',
			'loop of upserts',
		],
	},
	{
		label: 'Raw SQL',
		values: [
			'$raw + Drizzle, same connection',
			'sql everywhere',
			'$queryRaw',
		],
	},
	{
		label: 'Migrations',
		values: ['drizzle-kit', 'drizzle-kit', 'prisma migrate'],
	},
];

export function Comparison() {
	return (
		<section className="mx-auto max-w-6xl px-6 py-24">
			<div className="mx-auto max-w-2xl text-center">
				<h2 className="text-3xl font-semibold tracking-tight">
					How it compares
				</h2>
				<p className="text-fd-muted-foreground mt-4">
					Prisma-style calls on the Drizzle schema you already have.
					Raw Drizzle stays available for the queries that need SQL.
				</p>
			</div>
			<div className="border-fd-border mt-12 overflow-x-auto rounded-xl border">
				<table className="w-full min-w-[640px] text-left text-sm">
					<thead>
						<tr className="border-fd-border bg-fd-card/40 border-b">
							<th className="px-5 py-3 font-medium" />
							{COLUMNS.map((column, index) => (
								<th
									key={column}
									className={
										index === 0
											? 'text-brand px-5 py-3 font-semibold'
											: 'px-5 py-3 font-semibold'
									}
								>
									{column}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="divide-fd-border divide-y">
						{ROWS.map((row) => (
							<tr key={row.label}>
								<th className="text-fd-muted-foreground px-5 py-3 font-medium">
									{row.label}
								</th>
								{row.values.map((value, index) => (
									<td
										key={COLUMNS[index]}
										className={
											index === 0
												? 'text-fd-foreground px-5 py-3 font-medium'
												: 'text-fd-muted-foreground px-5 py-3'
										}
									>
										{value}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm font-semibold">
				<Link
					href="/docs/compare/drizzle"
					className="text-brand inline-flex items-center gap-2 hover:underline"
				>
					better-drizzle vs Drizzle
					<ArrowRight className="size-4" />
				</Link>
				<Link
					href="/docs/compare/prisma"
					className="text-brand inline-flex items-center gap-2 hover:underline"
				>
					better-drizzle vs Prisma
					<ArrowRight className="size-4" />
				</Link>
				<Link
					href="/docs/guides/migrating-from-prisma"
					className="text-fd-muted-foreground hover:text-fd-foreground inline-flex items-center gap-2"
				>
					Migrating from Prisma
					<ArrowRight className="size-4" />
				</Link>
			</div>
		</section>
	);
}
