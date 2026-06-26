import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.integration.test.ts', 'src/**/*.eval.test.ts']
				}
			},
			{
				test: {
					name: 'integration',
					environment: 'node',
					include: ['src/**/*.integration.test.ts'],
					setupFiles: ['src/tests/setup/firebase-emulators.ts']
				}
			},
			{
				// 実 LLM 評価ハーネス（任意実行・CI 非対象）。eval:judge スクリプトからのみ実行する。
				test: {
					name: 'eval',
					environment: 'node',
					include: ['src/**/*.eval.test.ts']
				}
			}
		]
	}
});
