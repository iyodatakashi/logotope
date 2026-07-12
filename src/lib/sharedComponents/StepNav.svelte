<script lang="ts">
	import { StepNav } from '@14ch/svelte-ui';
	import { phaseOrder, phasePath } from '$lib/models/phase/phase';
	import { type PhaseSlug } from '$lib/models/phase/phase.types';

	// ナビの見せ方（どのフェーズを1ステップに束ね、どう名付けるか）は UI の都合なので、
	// phase モデルではなくこのコンポーネントが持つ。モデルからは素のフェーズ情報だけを受け取る。
	// stakeholders/personas/interviews の3フェーズは「ペルソナ生成」1ステップに束ねる。
	// id は StepNav に渡すステップのユニークキー（value）。progress をこのキーで指定する。
	const STEP_GROUPS: readonly { id: string; label: string; phases: PhaseSlug[] }[] = [
		{ id: 'fact-research', label: '事実リサーチ', phases: ['fact-research'] },
		{ id: 'persona', label: 'ペルソナ生成', phases: ['stakeholders', 'personas', 'interviews'] },
		{ id: 'agenda', label: 'アジェンダ生成', phases: ['chapters'] },
		{ id: 'debate', label: '討論', phases: ['debate'] },
		{ id: 'editing', label: '編集', phases: ['editing'] }
	];

	// currentPath は実際に開いている URL。省略時は現在フェーズのパスで代替する。
	let {
		topicId,
		currentPhase,
		currentPath
	}: { topicId: string; currentPhase: PhaseSlug; currentPath?: string } = $props();

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

	// progress は到達済みの最遠ステップ。フェーズは順に進むため、現在フェーズを含むグループがそれに当たる。
	// 可変な配列 index ではなくステップのユニークキー（value）で指定する。
	const progress = $derived(STEP_GROUPS.find((group) => group.phases.includes(currentPhase))?.id);

	const resolvedCurrentPath = $derived(currentPath ?? phasePath(topicId, currentPhase));
</script>

<StepNav {stepItems} {progress} currentPath={resolvedCurrentPath} ariaLabel="討論生成フェーズ" />
