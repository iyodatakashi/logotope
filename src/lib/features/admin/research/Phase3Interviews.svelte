<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import type { TopicContext } from '$lib/models/topic/topic.types';
	import type { DraftBelief } from '$lib/models/persona/persona.types';

	const md = (text: string): string =>
		DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }));

	const DRAFT_LABELS: { key: keyof DraftBelief; label: string }[] = [
		{ key: 'stanceAndGrounds', label: '立場と根拠' },
		{ key: 'coreClaims', label: '核心的主張' },
		{ key: 'concerns', label: '懸念事項' },
		{ key: 'values', label: '価値観' },
		{ key: 'compromisePoints', label: '妥協点' },
		{ key: 'changePotential', label: '変化の可能性' }
	];

	const PHASE = 3;
	// 押下直後の楽観的な「実行中」表示用フラグ。サーバ権威のステータス書き込みには
	// 触れず、表示の即時フィードバックだけを担う。実状態(running)が反映されたら解除する。
	let isStarting = $state(false);
	const logicalState = $derived.by(() => {
		if (isStarting) return 'running';
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});
	$effect(() => {
		const topic = currentTopicStore.topic;
		if (
			topic &&
			phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE) === 'running'
		) {
			isStarting = false;
		}
	});
	const personasStore = $derived(currentTopicStore.personasStore);

	let expanded = $state<Set<string>>(new Set());

	const toggle = (id: string) => {
		expanded = new Set(
			expanded.has(id) ? [...expanded].filter((x) => x !== id) : [...expanded, id]
		);
	};

	const interviews = $derived(
		personasStore.personas.map((p) => ({
			personaId: p.id,
			personaName: p.name,
			role: p.specificRole ?? p.stakeholderRole,
			draftBelief: p.interview?.draftBelief,
			verificationReport: p.interview?.verificationReport ?? '',
			researchSummary: p.interview?.researchSummary ?? '',
			interviewRecord: p.interview?.interviewRecord ?? '',
			sources: p.interview?.sources ?? [],
			initialBelief: p.beliefs[0]?.content ?? '',
			status: p.interview?.status ?? 'pending'
		}))
	);

	const completedCount = $derived(
		personasStore.personas.filter((p) => p.interview?.status === 'completed').length
	);
	const errorCount = $derived(
		personasStore.personas.filter((p) => p.interview?.status === 'error').length
	);
	const pendingCount = $derived(personasStore.personas.filter((p) => p.interview == null).length);
	const totalCount = $derived(personasStore.personas.length);

	const buildTopicContext = (topic: {
		description?: string;
		fetchedSourceContents?: { content: string }[];
	}): TopicContext | undefined => {
		const description = topic.description;
		const sourceContents = topic.fetchedSourceContents?.map((fc) => fc.content);
		if (!description && !sourceContents?.length) return undefined;
		return { description, sourceContents };
	};

	const handleRetry = async (personaId: string) => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		const topicContext = buildTopicContext(topic);
		// 再実行前に stopped→running へ戻す。これがないとサーバの完了確定（running 限定）が
		// no-op となり、全件完了しても generated に到達しない。完了確定はサーバ権威で行う。
		await personasStore.markInterviewsStarted();
		try {
			await personasStore.runInterview(personaId, topic.title, topicContext);
		} catch {
			// サーバが当該ペルソナを error 永続化済み。再取材導線を出すため stopped に戻す。
			await personasStore.markInterviewsStopped();
		}
	};

	// 生成・やり直しは未完了ペルソナのみ取材。再生成は下流を破棄して全ペルソナを再取材する
	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		const topicContext = buildTopicContext(topic);
		isStarting = true;
		try {
			await personasStore.runInterviews(topic.title, topicContext);
		} finally {
			isStarting = false;
		}
	};
	// isStarting で押下直後に「実行中」表示へ切り替え、旧データを隠す（リセット完了を待たない）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		const topicContext = buildTopicContext(topic);
		isStarting = true;
		try {
			await topic.resetChapters();
			await topic.resetDebate();
			await personasStore.runInterviews(topic.title, topicContext, true);
		} finally {
			isStarting = false;
		}
	};
	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveInterviews();
		goto(phasePath(topic.id, 4));
	};
</script>

<PhasePanel
	{logicalState}
	title="フェーズ 3: ペルソナ取材"
	generateLabel="取材を開始する"
	approveLabel="承認して次へ進む"
	regenerateLabel="再取材する"
	regenerateConfirm={{
		title: '取材をやり直しますか？',
		description:
			'現在の取材記録と、以降のフェーズで生成済みのデータ（章立て・討論）が削除されます。',
		submitLabel: '再取材する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onRegenerate={regenerate}
>
	{#snippet progress()}
		{#if !isStarting && totalCount > 0}
			<div class="progress-summary">
				<span class="count completed">{completedCount} 完了</span>
				{#if pendingCount > 0}<span class="count pending">{pendingCount} 待機中</span>{/if}
				{#if errorCount > 0}<span class="count error-count">{errorCount} エラー</span>{/if}
				<span class="count total">/ {totalCount} 件</span>
			</div>
		{/if}
	{/snippet}
	{#snippet content()}
		{#if !isStarting && interviews.length > 0}
			<ul class="list">
				{#each interviews as iv (iv.personaId)}
					<li
						class="item"
						class:item-completed={iv.status === 'completed'}
						class:item-error={iv.status === 'error'}
						class:item-pending={iv.status === 'pending'}
					>
						<div class="toggle-row">
							<button class="toggle" onclick={() => toggle(iv.personaId)}>
								<span class="name-role">
									<strong>{iv.personaName}</strong>
									<span class="role">{iv.role}</span>
								</span>
								<span
									class="status-badge"
									class:done={iv.status === 'completed'}
									class:active={iv.status === 'in_progress'}
									class:err={iv.status === 'error'}
								>
									{#if iv.status === 'completed'}完了
									{:else if iv.status === 'in_progress'}取材中
									{:else if iv.status === 'error'}エラー
									{:else}待機中{/if}
								</span>
								{#if iv.initialBelief}
									<span class="arrow">{expanded.has(iv.personaId) ? '▲' : '▼'}</span>
								{/if}
							</button>
							{#if iv.status === 'error'}
								<Button variant="outlined" onclick={() => handleRetry(iv.personaId)}>
									リトライ
								</Button>
							{/if}
						</div>

						{#if expanded.has(iv.personaId) && iv.initialBelief}
							<div class="detail">
								{#if iv.draftBelief}
									<div class="section">
										<p class="section-label">① ドラフト信念（ステレオタイプ仮説）</p>
										<dl class="draft-belief">
											{#each DRAFT_LABELS as { key, label } (key)}
												<dt>{label}</dt>
												<dd>{iv.draftBelief[key]}</dd>
											{/each}
										</dl>
									</div>
								{/if}
								{#if iv.verificationReport}
									<div class="section">
										<p class="section-label">② リサーチに基づく検証（ギャップ）</p>
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
										<div class="md-body">{@html md(iv.verificationReport)}</div>
									</div>
								{/if}
								{#if iv.sources.length > 0}
									<div class="section">
										<p class="section-label">参照元</p>
										{#each iv.sources as source (source.query)}
											<div class="source-entry">
												<p class="source-summary">{source.summary}</p>
												<ul>
													{#each source.results as result (result.url)}
														<li>
															<a
																class="source-url"
																href={result.url}
																target="_blank"
																rel="noopener noreferrer">{result.url}</a
															>
														</li>
													{/each}
												</ul>
											</div>
										{/each}
									</div>
								{:else if iv.researchSummary}
									<div class="section">
										<p class="section-label">リサーチ内容</p>
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
										<div class="md-body">{@html md(iv.researchSummary)}</div>
									</div>
								{/if}
								<div class="section">
									<p class="section-label">③ 最終信念</p>
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
									<div class="md-body belief">{@html md(iv.initialBelief)}</div>
								</div>
								{#if iv.interviewRecord}
									<div class="section">
										<p class="section-label">取材記録</p>
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
										<div class="md-body">{@html md(iv.interviewRecord)}</div>
									</div>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.progress-summary {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 0.95rem;
	}
	.count {
		font-weight: 600;
	}
	.count.completed {
		color: #2e7d32;
	}
	.count.pending {
		color: #1565c0;
	}
	.count.error-count {
		color: #c62828;
	}
	.count.total {
		color: #555;
		font-weight: 400;
	}
	.list {
		list-style: none;
		padding: 0;
	}
	.item {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		margin-bottom: 6px;
		overflow: hidden;
	}
	.item-completed {
		border-color: #a5d6a7;
		background: #f9fff9;
	}
	.item-error {
		border-color: #ef9a9a;
		background: #fff9f9;
	}
	.item-pending {
		border-color: #90caf9;
		background: #f5f9ff;
	}
	.toggle-row {
		display: flex;
		align-items: center;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		padding: 10px 12px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}
	.toggle:hover {
		background: rgba(0, 0, 0, 0.03);
	}
	.name-role {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	.role {
		font-size: 0.75rem;
		color: #757575;
	}
	.status-badge {
		padding: 2px 8px;
		background: #e3f2fd;
		color: #1565c0;
		border-radius: 12px;
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	.status-badge.done {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.status-badge.active {
		background: #bbdefb;
		color: #1565c0;
		font-weight: 600;
	}
	.status-badge.err {
		background: #ffcdd2;
		color: #c62828;
	}
	.arrow {
		color: #757575;
		flex-shrink: 0;
	}
	.detail {
		border-top: 1px solid #e0e0e0;
	}
	.section {
		padding: 10px 12px;
		border-bottom: 1px solid #f0f0f0;
	}
	.section:last-child {
		border-bottom: none;
	}
	.section-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #757575;
		margin: 0 0 6px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.md-body {
		font-size: 0.875rem;
		line-height: 1.7;
		word-break: break-word;
		color: #333;
	}
	.md-body.belief {
		color: #1a237e;
	}
	.md-body :global(h1),
	.md-body :global(h2),
	.md-body :global(h3),
	.md-body :global(h4) {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 12px 0 4px;
	}
	.md-body :global(p) {
		margin: 4px 0;
	}
	.md-body :global(ul),
	.md-body :global(ol) {
		margin: 4px 0;
		padding-left: 20px;
	}
	.md-body :global(li) {
		margin: 2px 0;
	}
	.md-body :global(a) {
		color: #1565c0;
	}
	.md-body :global(code) {
		background: #f0f0f0;
		padding: 1px 4px;
		border-radius: 3px;
	}
	.draft-belief {
		font-size: 0.875rem;
		margin: 0;
	}
	.draft-belief dt {
		font-weight: 600;
		color: #555;
		margin-top: 8px;
	}
	.draft-belief dd {
		margin: 2px 0 0;
		white-space: pre-wrap;
		word-break: break-word;
		color: #333;
	}
	.source-entry {
		margin-bottom: 12px;
		padding-bottom: 12px;
		border-bottom: 1px dashed #e0e0e0;
	}
	.source-entry:last-child {
		border-bottom: none;
		margin-bottom: 0;
		padding-bottom: 0;
	}
	.source-summary {
		font-size: 0.875rem;
		color: #333;
		margin: 0 0 6px;
		line-height: 1.6;
	}
	.source-entry ul {
		margin: 0;
		padding-left: 16px;
	}
	.source-entry li {
		font-size: 0.8rem;
		margin-bottom: 6px;
	}
	.source-entry a {
		color: #1565c0;
		text-decoration: none;
	}
	.source-entry a:hover {
		text-decoration: underline;
	}
	.source-url {
		display: block;
		font-size: 0.7rem;
		color: #999;
		word-break: break-all;
	}
</style>
