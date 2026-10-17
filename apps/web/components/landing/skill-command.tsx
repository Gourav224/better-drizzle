'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

const COMMAND = 'npx skills add almeidazs/better-drizzle';

export function SkillCommand() {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(COMMAND);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// ignore
		}
	}

	return (
		<div className="border-fd-border bg-fd-card/60 inline-flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 font-mono text-sm">
			<code className="text-fd-foreground min-w-0 overflow-x-auto whitespace-nowrap">
				<span className="text-fd-muted-foreground select-none">$ </span>
				{COMMAND}
			</code>
			<button
				type="button"
				onClick={copy}
				aria-label={copied ? 'Copied' : 'Copy skill install command'}
				className="text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
			>
				{copied ? (
					<Check className="text-brand size-4" />
				) : (
					<Copy className="size-4" />
				)}
			</button>
		</div>
	);
}
