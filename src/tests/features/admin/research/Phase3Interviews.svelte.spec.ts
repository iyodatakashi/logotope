import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const makePersona = (overrides: Record<string, unknown> = {}) => ({
	id: 'p1',
	topicId: 't1',
	name: '田中太郎',
	stakeholderRole: '医師',
	age: 45,
	occupation: '外科医',
	background: '',
	interests: '',
	approved: true,
	beliefs: [{ version: 0, content: '初期信念の内容', createdAt: {} }],
	interview: {
		draftBelief: {
			stanceAndGrounds: 'ドラフト立場',
			coreClaims: 'ドラフト主張',
			concerns: 'ドラフト懸念',
			values: 'ドラフト価値観',
			compromisePoints: 'ドラフト妥協点',
			changePotential: 'ドラフト変化'
		},
		verificationReport: '## 相違点\n- ギャップ: 検証で判明した相違',
		interviewRecord: '取材記録の内容',
		sources: [],
		status: 'completed',
		completedAt: {}
	},
	sortOrder: 0,
	...overrides
});

let personaList: ReturnType<typeof makePersona>[] = [makePersona()];

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return { id: 't1', title: 'テストテーマ', phase: 'interviews', phaseStatus: 'generated' };
		},
		get personasStore() {
			return {
				get personas() {
					return personaList;
				},
				get isLoaded() {
					return true;
				},
				start: vi.fn(),
				stop: vi.fn(),
				runInterview: vi.fn()
			};
		}
	}
}));

import GenerateInterviewsPage from '$lib/features/admin/topic-detail/interview/GenerateInterviewsPage.svelte';

describe('GenerateInterviewsPage.svelte', () => {
	beforeEach(() => {
		personaList = [makePersona()];
	});

	it('取材済みのペルソナのデータを表示する', async () => {
		render(GenerateInterviewsPage);
		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
	});

	it('全員完了時は承認ボタンを表示する（PhasePanel経由、generated状態）', async () => {
		render(GenerateInterviewsPage);
		await expect
			.element(page.getByRole('button', { name: '承認して次へ進む' }))
			.toBeInTheDocument();
	});

	it('取材中（クリア済み・最終信念なし）は展開して詳細を出さない', async () => {
		// 開始時クリアで beliefs が空・中間データなしになった in_progress 状態
		personaList = [makePersona({ beliefs: [], interview: { status: 'in_progress' } })];
		render(GenerateInterviewsPage);
		const persona = page.getByText('田中太郎');
		await expect.element(persona).toBeInTheDocument();
		await persona.click();
		await expect.element(page.getByText('③ 最終信念')).not.toBeInTheDocument();
	});

	it('展開するとドラフト信念・検証ギャップ・最終信念を段階表示する', async () => {
		render(GenerateInterviewsPage);
		await page.getByText('田中太郎').click();
		await expect
			.element(page.getByText('① ドラフト信念（ステレオタイプ仮説）'))
			.toBeInTheDocument();
		await expect.element(page.getByText('ドラフト立場')).toBeInTheDocument();
		await expect.element(page.getByText('② リサーチに基づく検証（ギャップ）')).toBeInTheDocument();
		await expect.element(page.getByText('③ 最終信念')).toBeInTheDocument();
	});
});
