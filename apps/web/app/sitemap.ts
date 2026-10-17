import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/seo';
import { source } from '@/lib/source';

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{ url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
		{
			url: `${SITE_URL}/changelog`,
			changeFrequency: 'weekly',
			priority: 0.8,
		},
		...source.getPages().map((page) => ({
			url: `${SITE_URL}${page.url}`,
			changeFrequency: 'weekly' as const,
			priority: page.slugs.length === 0 ? 0.9 : 0.7,
		})),
	];
}
