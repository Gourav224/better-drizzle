'use client';

import { Check, Copy, FileText } from 'lucide-react';
import { useState } from 'react';
import { RiOpenaiFill } from 'react-icons/ri';
import { SiClaude } from 'react-icons/si';

const BUTTON =
	'border-fd-border bg-fd-card text-fd-muted-foreground hover:text-fd-foreground inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors hover:border-[#686868]';

/**
 * Copy the page as Markdown, open its `.md` version, or hand it to a chat
 * assistant. `markdownUrl` is the absolute `.md` URL of the page.
 */
export function PageActions({
	markdownPath,
	markdownUrl,
}: {
	markdownPath: string;
	markdownUrl: string;
}) {
	const [copied, setCopied] = useState(false);
	const prompt = encodeURIComponent(
		`Read ${markdownUrl} and help me use better-drizzle with it.`,
	);

	const copy = async () => {
		const response = await fetch(markdownPath);
		await navigator.clipboard.writeText(await response.text());
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="not-prose -mt-2 mb-2 flex flex-wrap gap-2">
			<button type="button" onClick={copy} className={BUTTON}>
				{copied ? (
					<Check className="size-3.5" />
				) : (
					<Copy className="size-3.5" />
				)}
				{copied ? 'Copied' : 'Copy Markdown'}
			</button>
			<a
				href={markdownPath}
				target="_blank"
				rel="noreferrer"
				className={BUTTON}
			>
				<FileText className="size-3.5" />
				View .md
			</a>
			<a
				href={`https://chatgpt.com/?hints=search&q=${prompt}`}
				target="_blank"
				rel="noreferrer"
				className={BUTTON}
			>
				<RiOpenaiFill className="size-3.5" />
				Open in ChatGPT
			</a>
			<a
				href={`https://claude.ai/new?q=${prompt}`}
				target="_blank"
				rel="noreferrer"
				className={BUTTON}
			>
				<SiClaude className="size-3.5" />
				Open in Claude
			</a>
		</div>
	);
}
