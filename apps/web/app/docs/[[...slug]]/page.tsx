import { flattenTree } from 'fumadocs-core/page-tree';
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	PageFooter,
} from 'fumadocs-ui/layouts/docs/page';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ComponentProps, ComponentType } from 'react';

import { DialectNotice } from '@/components/dialect';
import { JsonLd } from '@/components/json-ld';
import { PageActions } from '@/components/page-actions';
import { DIALECTS, type Dialect } from '@/lib/dialects';
import { SITE_NAME, SITE_URL } from '@/lib/seo';
import { markdownUrl, source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';

type PageParams = { params: Promise<{ slug?: string[] }> };
type DocsPageData = {
	description?: string;
	dialects?: Dialect[];
	full?: boolean;
	load(): Promise<{
		body: ComponentType<{
			components?: ReturnType<typeof getMDXComponents>;
		}>;
		toc?: ComponentProps<typeof DocsPage>['toc'];
	}>;
	seoDescription?: string;
	seoTitle?: string;
	title: string;
};

export default async function Page(props: PageParams) {
	const { slug } = await props.params;
	const page = source.getPage(slug);

	if (!page) notFound();

	const data = page.data as typeof page.data & DocsPageData;
	const { body: MDX, toc } = await data.load();
	const url = `${SITE_URL}${page.url}`;
	const breadcrumb = [
		{ name: SITE_NAME, url: SITE_URL },
		{ name: 'Documentation', url: `${SITE_URL}/docs` },
	];
	if (page.slugs.length > 0) breadcrumb.push({ name: data.title, url });

	return (
		<DocsPage toc={toc} full={data.full} footer={{ enabled: false }}>
			<JsonLd
				data={{
					'@context': 'https://schema.org',
					'@graph': [
						{
							'@type': 'TechArticle',
							headline: data.seoTitle ?? data.title,
							description:
								data.seoDescription ?? data.description,
							url,
							image: `${SITE_URL}/og/docs/${[...page.slugs, 'image.png'].join('/')}`,
							inLanguage: 'en',
							about: 'Drizzle ORM',
							isPartOf: { '@id': `${SITE_URL}/#website` },
							publisher: {
								'@type': 'Organization',
								name: SITE_NAME,
								url: SITE_URL,
							},
						},
						{
							'@type': 'BreadcrumbList',
							itemListElement: breadcrumb.map((item, index) => ({
								'@type': 'ListItem',
								position: index + 1,
								name: item.name,
								item: item.url,
							})),
						},
					],
				}}
			/>
			{data.dialects && <DialectNotice dialects={data.dialects} />}
			<DocsTitle>{data.title}</DocsTitle>
			<DocsDescription>{data.description}</DocsDescription>
			<PageActions
				markdownPath={markdownUrl(page.url)}
				markdownUrl={`${SITE_URL}${markdownUrl(page.url)}`}
			/>
			<DocsBody>
				<MDX
					components={getMDXComponents({
						a: createRelativeLink(source, page),
					})}
				/>
			</DocsBody>
			<DialectFooters url={page.url} />
		</DocsPage>
	);
}

/**
 * Previous/next links skip pages for other databases: one footer per distinct
 * result, picked by CSS from the selected database.
 */
function DialectFooters({ url }: { url: string }) {
	const items = flattenTree(source.getPageTree().children);
	const index = items.findIndex((item) => item.url === url);
	const footers = new Map<
		string,
		{ views: string[]; items: ComponentProps<typeof PageFooter>['items'] }
	>();

	for (const view of ['all', ...DIALECTS] as const) {
		const fits = (item: (typeof items)[number]) => {
			if (view === 'all') return true;
			const dialects = (
				source.getNodePage(item)?.data as DocsPageData | undefined
			)?.dialects;
			return !dialects || dialects.includes(view);
		};
		const previous = items.findLast((item, i) => i < index && fits(item));
		const next = items.find((item, i) => i > index && fits(item));
		const key = `${previous?.url} ${next?.url}`;
		const footer = footers.get(key);

		if (footer) footer.views.push(view);
		else footers.set(key, { views: [view], items: { previous, next } });
	}

	return [...footers].map(([key, footer]) => (
		<div key={key} data-dialect-view={footer.views.join(' ')}>
			<PageFooter items={footer.items} />
		</div>
	));
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(props: PageParams): Promise<Metadata> {
	const { slug } = await props.params;
	const page = source.getPage(slug);

	if (!page) notFound();

	const data = page.data as typeof page.data & DocsPageData;
	const title = data.seoTitle ?? data.title;
	const description = data.seoDescription ?? data.description;
	const image = `/og/docs/${[...page.slugs, 'image.png'].join('/')}`;

	return {
		title,
		description,
		alternates: {
			canonical: page.url,
			types: { 'text/markdown': markdownUrl(page.url) },
		},
		openGraph: {
			title: `${title} - ${SITE_NAME}`,
			description,
			url: page.url,
			siteName: SITE_NAME,
			locale: 'en_US',
			type: 'article',
			images: [{ url: image, width: 1200, height: 630, alt: data.title }],
		},
		twitter: {
			card: 'summary_large_image',
			title: `${title} - ${SITE_NAME}`,
			description,
			images: [image],
		},
	};
}
