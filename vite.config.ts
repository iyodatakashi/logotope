import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	// .svelte のまま配布される @14ch/svelte-firebase-auth を事前バンドルの対象から外し、
	// dedupe と併せて svelte の実体を1つに揃える。
	// @14ch/svelte-ui は対象に残す。外すと <style> が Vite クライアント経由の非同期注入になり、
	// 既存のコンポーネント spec が装飾の適用前に操作して落ちる（描画の互換を優先する）
	optimizeDeps: { exclude: ['@14ch/svelte-firebase-auth'] },
	resolve: { dedupe: ['svelte'] },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/**/*.integration.{test,spec}.{js,ts}'
					]
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					environment: 'node',
					include: ['src/**/*.integration.{test,spec}.{js,ts}'],
					setupFiles: ['src/tests/setup/firebase-emulators.ts']
				}
			}
		]
	}
});
