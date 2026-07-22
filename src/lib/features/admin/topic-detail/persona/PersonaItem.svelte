<script lang="ts">
	import type { Persona } from '$lib/models/persona/persona.types';
	import type { SvelteComponent } from 'svelte';
	import { Checkbox, Button, Input, Textarea } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import InterviewDialog from './InterviewDialog.svelte';

	let { persona, editable = true }: { persona: Persona; editable?: boolean } = $props();
	let interviewDialogRef: SvelteComponent | undefined = $state();

	// アバター再生成は画像だけを作り直す1操作。取材のような常駐ステータスを持たないため、
	// 進行中フラグはこの要素が自持ちする（store 側が開始時に avatarGeneratedAt を即時クリアするので、
	// 押下直後に表示は既定アバターへ縮退し、完了で新しい画像に置き換わる）。
	let regeneratingAvatar = $state(false);

	const interview = $derived(persona.interview);

	// 採用/不採用は安定 id をキーに永続する（フェーズ承認・前進とは独立にいつでも切替可能）。
	const toggleSelected = (selected: boolean) =>
		currentTopicStore.personasStore.setSelected(persona.id, selected);

	// 名前・年齢・肩書き・プロフィールのインライン編集を即保存する（取材は再実行しない）。
	// specificRole が未設定のペルソナでは undefined を書かない（Firestore が undefined を拒否するため）。
	const saveProfile = () => {
		currentTopicStore.personasStore.updatePersona(persona.id, {
			name: persona.name,
			age: persona.age,
			background: persona.background,
			...(persona.specificRole !== undefined ? { specificRole: persona.specificRole } : {})
		});
	};

	// 再取材はこのペルソナ1人だけを取り直す（取材の成否に関わらず常時可能）。
	const reinterview = () => {
		const title = currentTopicStore.topic?.title;
		if (!title) return;
		currentTopicStore.personasStore.reinterview(persona.id, title);
	};

	// アバターをこのペルソナ1人だけ作り直す。毎回別の seed／軸を引くので、押すたびに別の見た目になる。
	const regenerateAvatar = async () => {
		if (regeneratingAvatar) return;
		regeneratingAvatar = true;
		try {
			await currentTopicStore.personasStore.regenerateAvatar(persona.id);
		} finally {
			regeneratingAvatar = false;
		}
	};
</script>

<div class="persona-item">
	<div class="persona-item__header">
		<div class="persona-item__select">
			<Checkbox
				value={persona.selected}
				onchange={toggleSelected}
				disabled={!editable}
				ariaLabel="このペルソナを討論に採用する"
			/>
		</div>
		<span class="persona-item__name">
			<Input
				inline
				focusStyle="background"
				bind:value={persona.name}
				onchange={saveProfile}
				disabled={!editable}
				ariaLabel="ペルソナの名前"
			/>
		</span>
		<span class="persona-item__age">
			<Input
				inline
				type="number"
				min={0}
				focusStyle="background"
				bind:value={persona.age}
				onchange={saveProfile}
				disabled={!editable}
				ariaLabel="年齢"
			/>歳
		</span>
		<span
			class="persona-item__status-badge"
			class:persona-item__status-badge--done={interview?.status === 'completed'}
			class:persona-item__status-badge--active={interview?.status === 'in_progress'}
			class:persona-item__status-badge--err={interview?.status === 'error'}
		>
			{#if interview?.status === 'completed'}完了
			{:else if interview?.status === 'in_progress'}取材中
			{:else if interview?.status === 'error'}失敗
			{:else}待機中{/if}
		</span>
	</div>

	<div class="persona-item__badge">
		<Input
			inline
			fullWidth
			focusStyle="background"
			bind:value={persona.specificRole}
			onchange={saveProfile}
			disabled={!editable}
			ariaLabel="肩書き"
			placeholder={persona.stakeholderRole}
		/>
	</div>

	<div class="persona-item__bg">
		<Textarea
			inline
			minHeight={0}
			fullWidth
			focusStyle="background"
			bind:value={persona.background}
			onchange={saveProfile}
			disabled={!editable}
			ariaLabel="プロフィール"
		/>
	</div>

	<div class="persona-item__footer">
		<Button variant="ghost" rounded icon="menu_book" onclick={() => interviewDialogRef?.open()}>
			信念を見る
		</Button>
		<Button
			variant="ghost"
			rounded
			icon="cached"
			loading={interview?.status === 'in_progress'}
			disabled={!editable}
			onclick={reinterview}
		>
			再取材する
		</Button>
		<Button
			variant="ghost"
			rounded
			icon="face_retouching_natural"
			loading={regeneratingAvatar}
			disabled={!editable}
			onclick={regenerateAvatar}
		>
			アバター再生成
		</Button>
	</div>

	<InterviewDialog bind:this={interviewDialogRef} {persona} />
</div>

<style>
	.persona-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
		height: 100%;
		padding: 16px;
		background-color: var(--white);
		border: solid 1px var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}

	.persona-item__header {
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		align-items: center;
		gap: 8px;

		.persona-item__name {
			font-size: var(--svelte-ui-font-size-lg);
			font-weight: bold;
		}
	}

	.persona-item__bg {
		font-size: var(--svelte-ui-font-size-sm);
	}

	.persona-item__footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.persona-item__status-badge {
		padding: 2px 8px;
		background: #e3f2fd;
		color: #1565c0;
		border-radius: 12px;
		font-size: var(--svelte-ui-font-size-sm);
		flex-shrink: 0;
	}
	.persona-item__status-badge.persona-item__status-badge--done {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.persona-item__status-badge.persona-item__status-badge--active {
		background: #bbdefb;
		color: #1565c0;
		font-weight: 600;
	}
	.persona-item__status-badge.persona-item__status-badge--err {
		background: #ffcdd2;
		color: #c62828;
	}
</style>
