export const DIALECTS = ['postgresql', 'mysql', 'sqlite'] as const;

export type Dialect = (typeof DIALECTS)[number];

export const DIALECT_LABELS: Record<Dialect, string> = {
	postgresql: 'PostgreSQL',
	mysql: 'MySQL',
	sqlite: 'SQLite',
};

export const DIALECT_COOKIE = 'bd-dialect';

/**
 * The selected database lives in a cookie and on `<html data-dialect>`. CSS
 * hides everything marked for other databases, so pages stay static and the
 * filter applies before the first paint. `?dialect=` (from landing or shared
 * links) is stored and removed from the URL.
 */
export const DIALECT_SCRIPT = `(function(){try{var v=${JSON.stringify(DIALECTS)},n='${DIALECT_COOKIE}',u=new URL(location.href),q=u.searchParams.get('dialect');if(q!==null){if(v.indexOf(q)>-1)document.cookie=n+'='+q+';path=/;max-age=31536000;samesite=lax';else document.cookie=n+'=;path=/;max-age=0';u.searchParams.delete('dialect');history.replaceState(history.state,'',u)}var m=document.cookie.match(/(?:^|; )${DIALECT_COOKIE}=([^;]+)/);if(m&&v.indexOf(m[1])>-1)document.documentElement.setAttribute('data-dialect',m[1])}catch(e){}})()`;

export const isDialect = (value: unknown): value is Dialect =>
	DIALECTS.includes(value as Dialect);

/** Space-separated list for `[data-dialects~=x]` selectors. */
export const dialectList = (only: string | readonly string[]) => {
	const list = (
		typeof only === 'string' ? only.split(/[\s,]+/) : only
	).filter(isDialect);

	if (list.length === 0)
		throw new Error(`Unknown dialect list: ${String(only)}`);

	return list;
};
