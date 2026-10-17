/**
 * Typechecks every ```ts / ```tsx block in the docs.
 *
 * Each page gets a directory: titled blocks (`title="lib/db.ts"`) are written
 * at their title so imports between them resolve, the others as one module
 * each. Pages without their own `schema.ts` block share the prelude in
 * `doc-examples/` (schema, relations, a `client` with every official plugin,
 * and the globals snippets use without importing them) and one program; a
 * page with its own `schema.ts` gets a program of its own.
 *
 * Skip a block with a `noCheck` fence flag or an entry in
 * `doc-examples/skip.json` (page + content hash + reason).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { Glob } from 'bun';
import ts from 'typescript';

const root = join(import.meta.dir, '..');
const docs = join(root, 'apps/web/content/docs');
const prelude = join(import.meta.dir, 'doc-examples');
const out = join(root, 'node_modules/.cache/doc-examples');

type Skip = { file: string; hash: string; reason: string };
type Block = { page: string; line: number; hash: string };

const skips: Skip[] = JSON.parse(
	readFileSync(join(prelude, 'skip.json'), 'utf8'),
);
const skipped = new Set(skips.map((skip) => `${skip.file}#${skip.hash}`));
const used = new Set<string>();
const blocks = new Map<string, Block>();
const fence =
	/^([ \t]*)```(tsx?)(?:[ \t]+([^\n]*))?\n([\s\S]*?)^\1```[ \t]*$/gm;

const write = (path: string, content: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
};
const read = (name: string) => readFileSync(join(prelude, name), 'utf8');

/**
 * Snippets often show a handler body with a bare `return`. Those run inside an
 * async function; imports stay on top and line numbers are kept.
 */
const wrapReturns = (code: string) => {
	const file = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest);
	const hasReturn = (node: ts.Node): boolean =>
		ts.isReturnStatement(node) ||
		(!ts.isFunctionLike(node) &&
			!ts.isClassLike(node) &&
			ts.forEachChild(node, hasReturn) === true);
	const body = file.statements.filter(
		(statement) => !ts.isImportDeclaration(statement),
	);
	if (
		!body.some(hasReturn) ||
		body.some(
			(statement) =>
				ts.isExportDeclaration(statement) ||
				ts.isExportAssignment(statement) ||
				ts.getCombinedModifierFlags(statement as ts.Declaration) &
					ts.ModifierFlags.Export,
		)
	)
		return code;
	const start = body[0].getStart(file);
	return `${code.slice(0, start)}async function snippet() {${code.slice(start)}\n}`;
};

rmSync(out, { recursive: true, force: true });

const shared = join(out, 'shared');
for (const name of ['schema.ts', 'relations.ts', 'db.ts'])
	write(join(shared, '_prelude', name), read(name));
const globals = (base: string) =>
	read('globals.d.ts').replaceAll(
		'./',
		base.endsWith('/') ? base : `${base}/`,
	);
write(join(shared, 'globals.d.ts'), globals('./_prelude/'));
const modules = join(out, 'modules.d.ts');
write(modules, read('modules.d.ts'));

const programs = new Map<string, string[]>([
	[shared, [join(shared, 'globals.d.ts'), modules]],
]);
let total = 0;

for (const page of [...new Glob('**/*.mdx').scanSync(docs)].sort()) {
	const source = readFileSync(join(docs, page), 'utf8');
	const files = new Map<string, string>();

	for (const match of source.matchAll(fence)) {
		const [, indent, lang, meta = '', body] = match;
		if (/\bnoCheck\b/.test(meta)) continue;
		const code = indent
			? body.replaceAll(new RegExp(`^${indent}`, 'gm'), '')
			: body;
		const hash = createHash('sha1').update(code).digest('hex').slice(0, 10);
		if (skipped.has(`${page}#${hash}`)) {
			used.add(`${page}#${hash}`);
			continue;
		}
		const line = source.slice(0, match.index).split('\n').length + 1;
		const title = /title="([^"]+\.tsx?)"/.exec(meta)?.[1];
		const name =
			title && !files.has(title) ? title : `block-${line}.${lang}`;
		files.set(name, `${wrapReturns(code)}\nexport {};\n`);
		blocks.set(name, { page, line, hash });
		total += 1;
	}
	if (!files.size) continue;

	const own = files.has('schema.ts');
	const dir = own
		? join(out, 'pages', page.replace(/\.mdx$/, ''))
		: join(shared, page.replace(/\.mdx$/, ''));
	const up = own ? '.' : relative(dir, join(shared, '_prelude'));

	if (own) {
		const schema = files.get('schema.ts') as string;
		write(
			join(dir, '_client.ts'),
			[
				"import { better } from 'better-drizzle';",
				...(/sqlite(-core|Table)/.test(schema)
					? [
							"import { Database } from 'bun:sqlite';",
							"import { drizzle } from 'drizzle-orm/bun-sqlite';",
							"import { relations } from './relations';",
							"export const db = drizzle({ client: new Database(':memory:'), relations });",
						]
					: [
							`import { drizzle } from 'drizzle-orm/${/mysql(-core|Table)/.test(schema) ? 'mysql2' : 'node-postgres'}';`,
							"import { relations } from './relations';",
							"export const db = drizzle(process.env.DATABASE_URL ?? '', { relations });",
						]),
				'export const client = better(db);',
			].join('\n'),
		);
		write(
			join(dir, '_globals.d.ts'),
			globals('./').replaceAll("'./db'", "'./_client'"),
		);
		if (!files.has('relations.ts'))
			files.set(
				'relations.ts',
				"import { defineRelations } from 'drizzle-orm';\nimport * as schema from './schema';\nexport const relations = defineRelations(schema);\n",
			);
		if (!files.has('db.ts'))
			files.set('db.ts', "export * from './_client';\n");
		programs.set(dir, [join(dir, '_globals.d.ts'), modules]);
	} else
		for (const name of ['schema', 'relations', 'db'])
			if (!files.has(`${name}.ts`))
				files.set(`${name}.ts`, `export * from '${up}/${name}';\n`);

	// App modules a snippet imports without showing (`../src/db/relations`)
	// resolve to the page's schema, relations, and client.
	for (const [name, content] of files)
		if (blocks.has(name))
			for (const [, specifier] of content.matchAll(
				/from '(\.{1,2}\/[^']+)'/g,
			)) {
				const target = join(dirname(name), specifier);
				const kind = /(?:^|\/)(db|relations|schema)$/.exec(target)?.[1];
				if (
					!kind ||
					files.has(`${target}.ts`) ||
					files.has(`${target}.tsx`)
				)
					continue;
				const path = relative(
					join(dir, dirname(target)),
					join(dir, kind),
				);
				files.set(
					`${target}.ts`,
					`export * from '${path.startsWith('.') ? path : `./${path}`}';\n`,
				);
			}

	const program = programs.get(own ? dir : shared) as string[];
	for (const [name, content] of files) {
		const path = join(dir, name);
		// `@/x` (the Next.js alias) points at a module the page shows as `x.ts`.
		write(
			path,
			content.replace(/from '@\/([^']+)'/g, (match, target: string) => {
				if (!files.has(`${target}.ts`) && !files.has(`${target}.tsx`))
					return match;
				const to = relative(dirname(path), join(dir, target));
				return `from '${to.startsWith('.') ? to : `./${to}`}'`;
			}),
		);
		program.push(path);
		const block = blocks.get(name);
		if (block) {
			blocks.delete(name);
			blocks.set(path, block);
		}
	}
}

const base = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
const paths: Record<string, string[]> = {
	'better-drizzle/ata': [join(root, 'src/plugins/ata/index.ts')],
	// Framework examples import the app client through a path alias.
	'@/lib/db': [join(shared, '_prelude/db.ts')],
};
for (const [name, [target]] of Object.entries(
	base.compilerOptions.paths as Record<string, string[]>,
))
	paths[name] = [join(root, target)];
const options = ts.convertCompilerOptionsFromJson(
	{
		...base.compilerOptions,
		paths,
		noEmit: true,
		// Snippets often omit callback parameter types their real code infers.
		noImplicitAny: false,
		jsx: 'react-jsx',
		// Without DOM, `name` and friends are free names, not `window` globals.
		lib: ['es2022'],
		types: ['bun'],
		typeRoots: [join(root, 'node_modules/@types')],
	},
	out,
).options;

const failures = new Map<string, string[]>();
const report = (diagnostic: ts.Diagnostic) => {
	if (!diagnostic.file) return;
	const path = diagnostic.file.fileName;
	const block = blocks.get(path);
	const { line } = diagnostic.file.getLineAndCharacterOfPosition(
		diagnostic.start ?? 0,
	);
	const key = block
		? `${block.page}:${block.line} (hash ${block.hash})`
		: relative(out, path);
	const list = failures.get(key) ?? [];
	list.push(
		`  line ${block ? block.line + line : line + 1}: TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
	);
	failures.set(key, list);
};

for (const files of programs.values()) {
	const program = ts.createProgram(files, options);
	for (const file of program.getSourceFiles()) {
		if (!file.fileName.startsWith(out)) continue;
		const syntax = program.getSyntacticDiagnostics(file);
		if (syntax.length) syntax.forEach(report);
		else program.getSemanticDiagnostics(file).forEach(report);
	}
	program.getGlobalDiagnostics().forEach(report);
}

for (const [block, errors] of [...failures].sort())
	console.log(`${block}\n${errors.join('\n')}`);

const stale = skips.filter((skip) => !used.has(`${skip.file}#${skip.hash}`));
for (const skip of stale)
	console.log(`stale skip entry: ${skip.file}#${skip.hash} (${skip.reason})`);

console.log(
	`\n${total} blocks checked, ${failures.size} failing, ${used.size} skipped.`,
);
if (failures.size || stale.length) process.exit(1);
