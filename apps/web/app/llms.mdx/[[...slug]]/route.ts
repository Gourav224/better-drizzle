import { notFound } from 'next/navigation';

import { getPageMarkdown, source } from '@/lib/source';

export const revalidate = false;

/** Serves `/docs/<path>.md` (rewritten in `next.config.mjs`). */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	const { slug } = await params;
	const page = source.getPage(slug);

	if (!page) notFound();

	return new Response(await getPageMarkdown(page), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
}

export function generateStaticParams() {
	return source.generateParams();
}
