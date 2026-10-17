import { createMarkdownRenderer } from 'fumadocs-core/content/md';
import { rehypeCode, remarkGfm } from 'fumadocs-core/mdx-plugins';
import { Callout } from 'fumadocs-ui/components/callout';
import type { Metadata } from 'next';
import type { ComponentProps } from 'react';

import {
	getReleases,
	type Release,
	releaseAnchor,
	releaseTitle,
} from '@/lib/changelog';
import { SITE_NAME } from '@/lib/seo';
import { getMDXComponents } from '@/mdx-components';

export const revalidate = 3600;

const TITLE = 'Changelog';
const DESCRIPTION =
	'Every better-drizzle release for Drizzle ORM, newest first: new features, breaking changes, fixes, and the upgrade notes for each version.';

export const metadata: Metadata = {
	title: TITLE,
	description: DESCRIPTION,
	alternates: {
		canonical: '/changelog',
		types: {
			'text/markdown': '/changelog.md',
			'application/rss+xml': '/changelog/rss.xml',
		},
	},
	openGraph: {
		title: `${TITLE} - ${SITE_NAME}`,
		description: DESCRIPTION,
		url: '/changelog',
		siteName: SITE_NAME,
		type: 'website',
	},
};

const { MarkdownServer } = createMarkdownRenderer({
	remarkPlugins: [remarkGfm],
	rehypePlugins: [
		[
			rehypeCode,
			{
				engine: 'oniguruma',
				themes: { light: 'github-light', dark: 'github-dark' },
			},
		],
	],
});

const ALERTS = {
	NOTE: 'info',
	TIP: 'idea',
	IMPORTANT: 'warn',
	WARNING: 'warning',
	CAUTION: 'error',
} as const;

type Segment =
	| { kind: 'markdown'; text: string }
	| { kind: 'details'; summary: string; text: string }
	| {
			kind: 'alert';
			type: (typeof ALERTS)[keyof typeof ALERTS];
			text: string;
	  };

/**
 * GitHub release bodies use `<details>` blocks and `> [!NOTE]` alerts, which
 * plain Markdown rendering drops or shows verbatim.
 */
function splitBody(body: string) {
	const segments: Segment[] = [];
	const lines = body.split('\n');
	let buffer: string[] = [];
	const flush = () => {
		if (buffer.join('').trim())
			segments.push({ kind: 'markdown', text: buffer.join('\n') });
		buffer = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const alert = line.match(/^>\s*\[!(\w+)\]\s*$/);

		if (alert && alert[1].toUpperCase() in ALERTS) {
			flush();
			const text: string[] = [];
			while (lines[i + 1]?.startsWith('>'))
				text.push(lines[++i].replace(/^>\s?/, ''));
			segments.push({
				kind: 'alert',
				type: ALERTS[alert[1].toUpperCase() as keyof typeof ALERTS],
				text: text.join('\n'),
			});
			continue;
		}

		if (line.trim().startsWith('<details')) {
			flush();
			let summary = 'Details';
			const text: string[] = [];
			while (
				i + 1 < lines.length &&
				!lines[i + 1].includes('</details>')
			) {
				const next = lines[++i];
				const match = next.match(/<summary>(.*?)<\/summary>/);
				if (match) summary = match[1].replace(/<[^>]+>/g, '');
				else text.push(next);
			}
			i++;
			segments.push({ kind: 'details', summary, text: text.join('\n') });
			continue;
		}

		buffer.push(line);
	}
	flush();
	return segments;
}

function ReleaseBody({ body }: { body: string }) {
	const components = getMDXComponents() as ComponentProps<
		typeof MarkdownServer
	>['components'];

	return splitBody(body).map((segment, index) => {
		if (segment.kind === 'alert')
			return (
				<Callout key={index} type={segment.type}>
					<MarkdownServer components={components}>
						{segment.text}
					</MarkdownServer>
				</Callout>
			);
		if (segment.kind === 'details')
			return (
				<details key={index}>
					<summary className="cursor-pointer font-medium">
						{segment.summary}
					</summary>
					<MarkdownServer components={components}>
						{segment.text}
					</MarkdownServer>
				</details>
			);
		return (
			<MarkdownServer key={index} components={components}>
				{segment.text}
			</MarkdownServer>
		);
	});
}

function ReleaseSection({ release }: { release: Release }) {
	const anchor = releaseAnchor(release);

	return (
		<section
			id={anchor}
			className="border-fd-border grid scroll-mt-24 gap-4 border-t py-12 md:grid-cols-[180px_1fr] md:gap-10"
		>
			<div className="md:sticky md:top-24 md:self-start">
				<h2 className="text-2xl font-semibold tracking-tight">
					<a href={`#${anchor}`} className="hover:underline">
						{releaseTitle(release)}
					</a>
				</h2>
				<p className="text-fd-muted-foreground mt-1 text-sm">
					{release.unreleased ? 'Upcoming' : release.date}
				</p>
				{release.url && (
					<a
						href={release.url}
						target="_blank"
						rel="noreferrer"
						className="text-fd-muted-foreground hover:text-fd-foreground mt-2 inline-block text-sm"
					>
						GitHub release
					</a>
				)}
			</div>
			<div className="prose min-w-0">
				<ReleaseBody body={release.body} />
			</div>
		</section>
	);
}

export default async function ChangelogPage() {
	const releases = await getReleases();

	return (
		<main className="mx-auto w-full max-w-5xl px-6 pt-16 pb-24">
			<h1 className="text-4xl font-semibold tracking-tight">{TITLE}</h1>
			<p className="text-fd-muted-foreground mt-4 max-w-2xl text-lg">
				Every better-drizzle release, newest first. Also available as{' '}
				<a href="/changelog.md" className="underline">
					Markdown
				</a>{' '}
				and{' '}
				<a href="/changelog/rss.xml" className="underline">
					RSS
				</a>
				. To move between versions, see the{' '}
				<a href="/docs/guides/upgrading" className="underline">
					upgrading guide
				</a>
				.
			</p>
			<div className="mt-12">
				{releases.map((release) => (
					<ReleaseSection key={release.version} release={release} />
				))}
			</div>
		</main>
	);
}
