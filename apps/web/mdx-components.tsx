import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

import { CopyPrompt } from '@/components/copy-prompt';
import { Dialect, DialectTabs } from '@/components/dialect';
import { ShinyCodeBlock } from '@/components/shiny-code-block';
import { Since } from '@/components/since';

/**
 * Components available to every MDX page. Spread `defaultMdxComponents` first so
 * built-ins (code blocks, headings, links, Cards) work, then register the extra
 * interactive components the docs use.
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
	return {
		...defaultMdxComponents,
		pre: ShinyCodeBlock,
		Accordion,
		Accordions,
		Callout,
		Card,
		Cards,
		CopyPrompt,
		Dialect,
		DialectTabs,
		Since,
		Tab,
		Tabs,
		Step,
		Steps,
		TypeTable,
		...components,
	};
}

export const useMDXComponents = getMDXComponents;
