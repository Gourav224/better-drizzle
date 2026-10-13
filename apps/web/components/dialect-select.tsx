'use client';

import { cn } from 'cnfast';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from 'fumadocs-ui/components/ui/popover';
import { Check, ChevronsUpDown, Database } from 'lucide-react';
import Link from 'next/link';
import {
	type ComponentProps,
	type ComponentType,
	useState,
	useSyncExternalStore,
} from 'react';
import { SiMysql, SiPostgresql, SiSqlite } from 'react-icons/si';

import { DIALECT_COOKIE, DIALECT_LABELS, type Dialect } from '@/lib/dialects';

type Choice = Dialect | 'all';

const CHANGE_EVENT = 'bd-dialect';

const OPTIONS: {
	value: Choice;
	label: string;
	icon: ComponentType<{ className?: string }>;
	iconClassName: string;
}[] = [
	{
		value: 'all',
		label: 'All databases',
		icon: Database,
		iconClassName: 'text-fd-muted-foreground',
	},
	{
		value: 'postgresql',
		label: DIALECT_LABELS.postgresql,
		icon: SiPostgresql,
		iconClassName: 'text-[#336791] dark:text-[#6b9bd1]',
	},
	{
		value: 'mysql',
		label: DIALECT_LABELS.mysql,
		icon: SiMysql,
		iconClassName: 'text-[#00758F] dark:text-[#5fb3c9]',
	},
	{
		value: 'sqlite',
		label: DIALECT_LABELS.sqlite,
		icon: SiSqlite,
		iconClassName: 'text-[#0F80CC] dark:text-[#4ea8e6]',
	},
];

export function setDialect(value: Choice) {
	const root = document.documentElement;

	if (value === 'all') {
		document.cookie = `${DIALECT_COOKIE}=;path=/;max-age=0`;
		root.removeAttribute('data-dialect');
	} else {
		document.cookie = `${DIALECT_COOKIE}=${value};path=/;max-age=31536000;samesite=lax`;
		root.setAttribute('data-dialect', value);
	}

	window.dispatchEvent(new Event(CHANGE_EVENT));
}

const subscribe = (callback: () => void) => {
	window.addEventListener(CHANGE_EVENT, callback);
	return () => window.removeEventListener(CHANGE_EVENT, callback);
};

const getDialect = (): Choice =>
	(document.documentElement.getAttribute('data-dialect') as Dialect) ?? 'all';

function OptionLabel({ option }: { option: (typeof OPTIONS)[number] }) {
	return (
		<>
			<option.icon
				className={cn('size-4 shrink-0', option.iconClassName)}
			/>
			<span className="text-sm font-medium">{option.label}</span>
		</>
	);
}

/** Database picker at the top of the docs sidebar. */
export function DialectSelect() {
	const [open, setOpen] = useState(false);
	const current = useSyncExternalStore(subscribe, getDialect, () => 'all');

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label="Database"
				className="bg-fd-secondary/50 text-fd-secondary-foreground hover:bg-fd-accent data-[state=open]:bg-fd-accent flex w-full items-center gap-2 rounded-lg border p-2 text-start transition-colors"
			>
				{/* One label per choice, picked by CSS so the server HTML never flickers. */}
				{OPTIONS.map((option) => (
					<span key={option.value} data-dialect-view={option.value}>
						<OptionLabel option={option} />
					</span>
				))}
				<ChevronsUpDown className="text-fd-muted-foreground ms-auto size-4 shrink-0" />
			</PopoverTrigger>
			<PopoverContent className="flex w-(--radix-popover-trigger-width) flex-col gap-1 p-1">
				{OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						onClick={() => {
							setDialect(option.value);
							setOpen(false);
						}}
						className="hover:bg-fd-accent hover:text-fd-accent-foreground flex items-center gap-2 rounded-lg p-1.5 text-start"
					>
						<OptionLabel option={option} />
						<Check
							className={cn(
								'text-fd-primary ms-auto size-3.5 shrink-0',
								current !== option.value && 'invisible',
							)}
						/>
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}

export function DialectSwitchButton({
	dialect,
	...props
}: ComponentProps<'button'> & { dialect: Dialect }) {
	return (
		<button type="button" onClick={() => setDialect(dialect)} {...props} />
	);
}

/** A link that selects a database before opening the docs. */
export function DialectLink({
	dialect,
	onClick,
	...props
}: ComponentProps<typeof Link> & { dialect: Dialect }) {
	return (
		<Link
			{...props}
			onClick={(event) => {
				setDialect(dialect);
				onClick?.(event);
			}}
		/>
	);
}
