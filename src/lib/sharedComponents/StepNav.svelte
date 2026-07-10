<script lang="ts">
	import { Tab } from '@14ch/svelte-ui';
	import { stepNavItems, phasePath } from '$lib/models/phase/phase';
	import { type PhaseSlug } from '$lib/models/phase/phase.types';

	// currentPath は実際に開いている URL。省略時は現在フェーズのパスで代替する。
	// グループ内（例: stakeholders/personas/interviews）のどの URL でも同一タブがアクティブになる。
	let {
		topicId,
		currentPhase,
		currentPath
	}: { topicId: string; currentPhase: PhaseSlug; currentPath?: string } = $props();

	const items = $derived(stepNavItems(topicId, currentPhase));
	const resolvedCurrentPath = $derived(currentPath ?? phasePath(topicId, currentPhase));
	const tabItems = $derived(
		items.map((item) => ({ label: item.label, href: item.href, disabled: item.disabled }))
	);

	// 現在 URL の末尾 slug がそのグループの phases に含まれるかで1タブのアクティブを判定する。
	const matchByGroup = (path: string, itemHref: string): boolean => {
		const slug = path.split('/').at(-1) as PhaseSlug | undefined;
		const group = items.find((item) => item.href === itemHref);
		return !!group && !!slug && group.phases.includes(slug);
	};
</script>

<Tab
	{tabItems}
	currentPath={resolvedCurrentPath}
	customPathMatcher={matchByGroup}
	ariaLabel="討論生成フェーズ"
/>
