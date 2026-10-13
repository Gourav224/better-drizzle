import { Tabs } from 'fumadocs-ui/components/tabs';
import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from 'react';

import { DialectSwitchButton } from '@/components/dialect-select';
import {
	DIALECT_LABELS,
	DIALECTS,
	type Dialect as DialectName,
	dialectList,
} from '@/lib/dialects';

/**
 * Content for some databases only, hidden while another one is selected.
 * Headings inside also leave the table of contents.
 */
export function Dialect({
	only,
	children,
}: {
	only: string;
	children: ReactNode;
}) {
	const list = dialectList(only);
	const ids: string[] = [];

	Children.forEach(children, (child) => {
		if (!isValidElement<{ id?: unknown }>(child)) return;
		if (typeof child.props.id === 'string') ids.push(child.props.id);
	});

	const selectors: string[] = [];
	for (const dialect of DIALECTS)
		if (!list.includes(dialect))
			for (const id of ids)
				selectors.push(
					`html[data-dialect='${dialect}'] a[href='#${id}']`,
				);

	return (
		<div data-dialects={list.join(' ')} className="contents">
			{selectors.length > 0 && (
				<style>{`${selectors.join(',')}{display:none}`}</style>
			)}
			{children}
		</div>
	);
}

const LABEL_TO_DIALECT = Object.fromEntries(
	DIALECTS.map((dialect) => [DIALECT_LABELS[dialect], dialect]),
) as Record<string, DialectName>;

/**
 * Per-database variants of a block: synced tabs under "All databases",
 * otherwise only the selected database's tab content.
 */
export function DialectTabs({ children }: { children: ReactNode }) {
	const tabs = Children.toArray(children).filter(
		isValidElement,
	) as ReactElement<{ value: string; children: ReactNode }>[];

	return (
		<>
			<div data-dialect-view="all">
				<Tabs
					items={tabs.map((tab) => tab.props.value)}
					groupId="dialect"
					persist
				>
					{children}
				</Tabs>
			</div>
			{tabs.map((tab) => {
				const dialect = LABEL_TO_DIALECT[tab.props.value];
				if (!dialect)
					throw new Error(`Unknown dialect tab: ${tab.props.value}`);

				return (
					<div key={dialect} data-dialect-view={dialect}>
						{tab.props.children}
					</div>
				);
			})}
		</>
	);
}

const formatList = (dialects: readonly DialectName[]) => {
	const names = dialects.map((dialect) => DIALECT_LABELS[dialect]);
	return names.length > 1
		? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
		: names[0];
};

/** Shown when the selected database is not one the page applies to. */
export function DialectNotice({
	dialects,
}: {
	dialects: readonly DialectName[];
}) {
	return (
		<div
			data-dialect-notice={dialects.join(' ')}
			className="border-fd-border bg-fd-card mb-6 flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-4 text-sm"
		>
			<p className="text-fd-muted-foreground flex-1">
				This page is{' '}
				<span className="text-fd-foreground font-medium">
					{formatList(dialects)}
				</span>{' '}
				only.
			</p>
			<div className="flex flex-wrap gap-2">
				{dialects.map((dialect) => (
					<DialectSwitchButton
						key={dialect}
						dialect={dialect}
						className="bg-brand text-brand-contrast rounded-lg px-3 py-1.5 font-semibold transition-opacity hover:opacity-90"
					>
						Switch to {DIALECT_LABELS[dialect]}
					</DialectSwitchButton>
				))}
			</div>
		</div>
	);
}
