import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { generateStakeholders as runStakeholderGeneration } from '../../agents/stakeholder-agent.js';
import {
	generatePersonas as runPersonaGeneration,
	sourceTagForIndex
} from '../../agents/persona-generator-agent.js';
import type { GeneratedPersona } from '../../agents/persona-generator-agent.js';
import { getTopicContext } from '../topics/topic-context.js';
import { runInterviewCore } from '../../api/interviews.js';
import { runAvatarCore } from '../../api/avatars.js';
import { enqueuePersonaStep } from './enqueue-persona-step.js';
import { assignAll } from './avatar-color.js';
import type { PersonaStepPayload } from './enqueue-persona-step.js';
import type { Stakeholder } from '../../types/stakeholder.types.js';
import type { Persona } from '../../types/persona.types.js';
import type { PhaseSlug, PhaseStatus } from '../../types/phase.types.js';

// ペルソナ生成の一気通貫を「1ステップ＝1 Cloud Task」のチェーンとして駆動する層（討論・編集と同型）。
// 停止ゲート（世代照合）→当該段の実行＋生成物永続→次段 enqueue の自己連鎖にする。
// 中間段（stakeholders / personas）は完了確定を書かない。generated 確定は取材段の
// confirmInterviewsGeneratedIfAllComplete（全ペルソナ completed 時）でのみ行う（早期遷移を防ぐ）。

const db = () => getFirestore();

/** チェーンが稼働中（phase personas・phaseStatus running・runId 一致）かを判定する。旧世代タスクを弾く */
const isPersonaRunActive = async (topicId: string, runId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: PhaseSlug; phaseStatus?: PhaseStatus; runId?: string };
	return data.phase === 'personas' && data.phaseStatus === 'running' && data.runId === runId;
};

/** テーマ名を topic ドキュメントから読む（生成エージェントのプロンプトに使う） */
const readTopicTitle = async (topicId: string): Promise<string> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	return (snap.data() as { title?: string })?.title ?? '';
};

// 生成結果のエコー用タグから由来ステークホルダーの id を解決する（出力順非依存）。
// タグ欠落/不正時は、出力位置（k 番目）と役割名照合でフォールバックする。
const resolveStakeholderId = (
	persona: GeneratedPersona,
	outputIndex: number,
	stakeholders: Stakeholder[]
): string => {
	const byTag = stakeholders.find((_, i) => sourceTagForIndex(i) === persona.sourceTag);
	if (byTag) return byTag.id;
	const byPosition = stakeholders[outputIndex];
	if (byPosition) return byPosition.id;
	const byRole = stakeholders.find((stakeholder) => stakeholder.role === persona.stakeholderRole);
	return (byRole ?? stakeholders[0]).id;
};

/**
 * stakeholders 段: ステークホルダーを生成し安定 id を付番して stakeholders/0 に永続する。
 * 完了確定は書かない（次段 enqueue のみ）。
 */
const runStakeholdersStage = async (topicId: string): Promise<void> => {
	const title = await readTopicTitle(topicId);
	const topicContext = await getTopicContext(topicId);
	const result = await runStakeholderGeneration(title, topicContext);
	if (!result.ok) {
		const message = 'message' in result.error ? result.error.message : result.error.code;
		throw new Error(message);
	}
	// 各ステークホルダーへ配列位置に依存しない安定 id を付番する。
	// これがペルソナ由来対応づけ（persona.stakeholderId）の唯一の突合キーになる。
	const stakeholdersWithId = result.value.stakeholders.map((stakeholder) => ({
		...stakeholder,
		id: nanoid()
	}));
	await db().doc(`topics/${topicId}/stakeholders/0`).set({ stakeholders: stakeholdersWithId });
};

/**
 * personas 段: 全ステークホルダーを対象にペルソナを生成し、各ペルソナを採用既定 ON（selected: true）で
 * 永続する。生成した各ペルソナ id を返す（取材段の per-persona enqueue に使う）。完了確定は書かない。
 */
const runPersonasStage = async (topicId: string): Promise<string[]> => {
	const snap = await db().doc(`topics/${topicId}/stakeholders/0`).get();
	if (!snap.exists) throw new Error('stakeholders not found');
	const stakeholders = (snap.data() as { stakeholders: Stakeholder[] }).stakeholders;

	const title = await readTopicTitle(topicId);
	const topicContext = await getTopicContext(topicId);
	const result = await runPersonaGeneration(title, stakeholders, topicId, topicContext);
	if (!result.ok) {
		const message = 'message' in result.error ? result.error.message : result.error.code;
		throw new Error(message);
	}

	// 配色は生成時に1回だけ確定させる（以後再計算しない）。乱数を使わず人数と sortOrder だけで
	// 決まるため、並べ替え・再表示で既存の割り当てが動かない。
	const colorKeys = assignAll(result.value.personas.length);

	// 全ペルソナ文書を一括（batch）で永続化する。途中失敗では未コミット（全件 or 未書込）。
	const batch = db().batch();
	const personaIds: string[] = [];
	result.value.personas.forEach((persona, index) => {
		// sourceTag は由来解決用の一時項目。永続前に stakeholderId へ畳んで除去する。
		const { id, sourceTag: _sourceTag, ...rest } = persona;
		batch.set(db().doc(`topics/${topicId}/personas/${id}`), {
			...rest,
			stakeholderId: resolveStakeholderId(persona, index, stakeholders),
			sortOrder: index,
			colorKey: colorKeys[index],
			selected: true,
			beliefs: [],
			createdAt: Timestamp.now()
		});
		personaIds.push(id);
	});
	await batch.commit();
	return personaIds;
};

/** interview 段（per persona）: 当該ペルソナを取材し結果を永続する（完了確定は core が担う） */
const runInterviewStage = async (topicId: string, personaId: string): Promise<void> => {
	const snap = await db().doc(`topics/${topicId}/personas/${personaId}`).get();
	if (!snap.exists) throw new Error(`persona ${personaId} not found`);
	const data = snap.data() as Persona;
	const persona: Persona = {
		...data,
		id: personaId,
		specificRole: data.specificRole ?? data.stakeholderRole
	};
	const topicTitle = await readTopicTitle(topicId);
	await runInterviewCore(topicId, personaId, topicTitle, persona);
};

/**
 * 1 ペルソナ生成ステップを処理する再入可能ディスパッチャ。
 * stakeholders: ステークホルダーを生成・永続し、personas 段を投入する。
 * personas: 全ステークホルダーからペルソナを生成・永続し、ペルソナごとに interview 段を投入する。
 * interview: 当該ペルソナを取材し結果を永続する（終端。次段は投入しない。generated 確定は core が判定）。
 */
export const advancePersonaChain = async (payload: PersonaStepPayload): Promise<void> => {
	const { topicId, runId, stepKind, personaId } = payload;

	// アバター段は running ゲートの前に処理する。取材が全件完了すると personas は generated へ遷移し
	// running でなくなるため、running を要求すると並走中のアバター段が取りこぼされる。旧世代タスクは
	// 対象 persona が discardPersonas で消えており runAvatarCore が no-op になるため、ゲート無しで安全。
	if (stepKind === 'avatar') {
		if (!personaId) throw new Error('personaId is required for avatar step');
		await runAvatarCore(topicId, personaId);
		return;
	}

	if (!(await isPersonaRunActive(topicId, runId))) return;

	if (stepKind === 'stakeholders') {
		await runStakeholdersStage(topicId);
		await enqueuePersonaStep({ topicId, runId, stepKind: 'personas' });
		return;
	}

	if (stepKind === 'personas') {
		const personaIds = await runPersonasStage(topicId);
		// ペルソナごとに取材段とアバター段を並列投入する。取材が generated 確定を担い、
		// アバターはそれと独立の副生成（best-effort・失敗は未生成のまま残す）。
		for (const id of personaIds) {
			await enqueuePersonaStep({ topicId, runId, stepKind: 'interview', personaId: id });
			await enqueuePersonaStep({ topicId, runId, stepKind: 'avatar', personaId: id });
		}
		return;
	}

	if (!personaId) throw new Error(`personaId is required for ${stepKind} step`);
	await runInterviewStage(topicId, personaId);
};
