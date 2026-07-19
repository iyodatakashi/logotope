<script lang="ts">
	import { StepNav } from '@14ch/svelte-ui';
	import { phasePath } from '$lib/models/phase/phase';
	import { type PhaseSlug, type PhaseStatus } from '$lib/models/phase/phase.types';

	// ナビの見せ方（どのフェーズを1ステップに束ね、どう名付けるか）は UI の都合なので、
	// phase モデルではなくこのコンポーネントが持つ。モデルからは素のフェーズ情報だけを受け取る。
	// ペルソナ生成は単一フェーズ personas に対応する（ステークホルダー生成〜取材の一気通貫全体）。
	// id は StepNav に渡すステップのユニークキー（value）。progress をこのキーで指定する。
	const STEP_GROUPS: readonly { id: string; label: string; phases: PhaseSlug[] }[] = [
		{ id: 'theme', label: 'テーマ設定', phases: ['theme'] },
		{ id: 'fact-research', label: '事実リサーチ', phases: ['fact-research'] },
		{ id: 'persona', label: 'ペルソナ生成', phases: ['personas'] },
		{ id: 'agenda', label: 'アジェンダ生成', phases: ['chapters'] },
		{ id: 'debate', label: '討論', phases: ['debate'] },
		{ id: 'editing', label: '編集', phases: ['editing'] },
		{ id: 'publish', label: '公開', phases: ['publish'] }
	];

	// currentPath は実際に開いている URL。省略時は現在フェーズのパスで代替する。
	// phaseStatus/published は現在フェーズの完了判定に使う（progress.status の導出）。
	let {
		topicId,
		currentPhase,
		phaseStatus,
		published,
		currentPath
	}: {
		topicId: string;
		currentPhase: PhaseSlug;
		phaseStatus: PhaseStatus;
		published: boolean;
		currentPath?: string;
	} = $props();

	// href: グループが現在フェーズを含むならそのフェーズ、含まなければ先頭フェーズへのパス。
	// matchingPath: グループ内（例: stakeholders/personas/interviews）のどの URL でも
	//               同一ステップがアクティブになるよう、束ねた全フェーズのパスを渡す（判定はライブラリに任せる）。
	// disabled: グループ先頭フェーズが現在フェーズより後（未到達）なら不活性。
	const stepItems = $derived(
		STEP_GROUPS.map((group) => ({
			value: group.id,
			label: group.label,
			href: phasePath(
				topicId,
				group.phases.includes(currentPhase) ? currentPhase : group.phases[0]
			),
			matchingPath: group.phases.map((phase) => phasePath(topicId, phase))
		}))
	);

	// progress は到達済みの最遠ステップ（現在フェーズを含むグループ）。可変な配列 index ではなく
	// ステップのユニークキー（value）で指定する。status は現在フェーズの完了判定:
	// publish は可逆トグル published、それ以外は phaseStatus === 'generated' を完了とみなす。
	// status: 'done' なら現在ステップ自身も完了表示になり、手前の前進済みステップは自動で completed。
	const progressStep = $derived(
		STEP_GROUPS.find((group) => group.phases.includes(currentPhase))?.id
	);
	const progressStatus = $derived<'done' | 'in-progress'>(
		(currentPhase === 'publish' ? published : phaseStatus === 'generated') ? 'done' : 'in-progress'
	);
	const progress = $derived(
		progressStep ? { step: progressStep, status: progressStatus } : undefined
	);

	const resolvedCurrentPath = $derived(currentPath ?? phasePath(topicId, currentPhase));
</script>

<StepNav {stepItems} {progress} currentPath={resolvedCurrentPath} ariaLabel="討論生成フェーズ" />
