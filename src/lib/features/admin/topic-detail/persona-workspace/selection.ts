import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
import type { Persona } from '$lib/models/persona/persona.types';

// ステークホルダーに対応するペルソナを安定 id で解決する。
export const matchPersona = (
	stakeholder: Stakeholder,
	personas: Persona[]
): Persona | undefined =>
	personas.find((persona) => persona.stakeholderId === stakeholder.id);

// 採用選択の整合（reconcile）。
// まだシードされていない（新規に現れた）ステークホルダー id のみを既定 ON でシードし、
// 既存のユーザ選択/解除は保持する。ステークホルダー総入れ替え時は全 id が新規となり新集合が全 ON になる。
// seededIds は「一度でも観測した id」の集合で、既定シードの二重適用を防ぐ。
export const reconcileSelection = (input: {
	stakeholders: Stakeholder[];
	selectedIds: Set<string>;
	seededIds: Set<string>;
}): { selectedIds: Set<string>; seededIds: Set<string>; changed: boolean } => {
	const nextSelected = new Set(input.selectedIds);
	const nextSeeded = new Set(input.seededIds);
	let changed = false;
	for (const stakeholder of input.stakeholders) {
		if (nextSeeded.has(stakeholder.id)) continue;
		nextSeeded.add(stakeholder.id);
		nextSelected.add(stakeholder.id); // 既定 ON（R3-2）
		changed = true;
	}
	return { selectedIds: nextSelected, seededIds: nextSeeded, changed };
};
