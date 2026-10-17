import { getDocsSections, getPageMarkdown } from '@/lib/source';

export const revalidate = false;

/** Every docs page as Markdown, in sidebar order. */
export async function GET() {
	const pages = getDocsSections().flatMap((section) => section.pages);
	const texts = await Promise.all(pages.map(getPageMarkdown));

	return new Response(texts.join('\n---\n\n'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}
