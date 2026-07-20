import { defineConfig } from 'vitest/config';

// オフライン生成ツール専用の最小テスト設定（本体アプリの vite.config.ts とは独立）。
export default defineConfig({
	root: import.meta.dirname,
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts']
	}
});
