'use client';

import { cn } from 'cnfast';
import { Bot, Check } from 'lucide-react';
import { useState } from 'react';

import { SITE_URL } from '@/lib/seo';

export const SETUP_PROMPT = `Set up better-drizzle in this project.

1. Read ${SITE_URL}/llms.txt and follow the linked docs (append .md to any docs URL for Markdown).
2. Check the installed drizzle-orm version. better-drizzle needs Drizzle ORM 1.x (drizzle-orm@1.0.0-rc.4) with defineRelations; on drizzle-orm 0.x, use better-drizzle 0.2.x or upgrade Drizzle first.
3. Install better-drizzle with the project's package manager.
4. Wrap the existing Drizzle client: const db = better(drizzle({ client, relations })). Keep the schema and relations as they are.
5. Use the typed delegates (db.<table>.findMany, create, update, upsert, paginate, transaction) for new data access, and keep raw Drizzle for queries the delegates do not cover.
6. Run the type checker and the tests.`;

/** Copies a prompt that lets a coding agent install and configure better-drizzle. */
export function CopyPrompt({ className }: { className?: string }) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		await navigator.clipboard.writeText(SETUP_PROMPT);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<button
			type="button"
			onClick={copy}
			className={cn(
				'not-prose border-fd-border bg-fd-card text-fd-foreground inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors hover:border-[#686868] hover:bg-white/[0.06]',
				className,
			)}
		>
			{copied ? (
				<Check className="text-brand size-4" />
			) : (
				<Bot className="size-4" />
			)}
			{copied ? 'Prompt copied' : 'Copy setup prompt for your agent'}
		</button>
	);
}
