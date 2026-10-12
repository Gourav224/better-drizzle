import { describe } from 'bun:test';

import { runLeakSuite, sqliteLeakHarness } from './leak-suite';

describe('tenant isolation (SQLite)', () => {
	runLeakSuite(sqliteLeakHarness());
});
