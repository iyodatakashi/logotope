import { getFirestore } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { editChapter, editComments } from '../../agents/editor-agent.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import { pipelineErrorMessage } from '../debate/utils.js';
import { writeEditedChapter, writeEditedComments } from './edited-repository.js';
import { finalizeEditingRun } from './editing-lifecycle.js';
import type { EditedTurnDraft } from '../../agents/editor-agent.js';
import type {
	EditedChapterForFirestore,
	EditedTurnForFirestore,
	EditedPostDebateCommentForFirestore,
	NonEmptyArray
} from '../../types/editorial.types.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';
import type { Result, PipelineError } from '../../types/common.types.js';

// 編集チェーンの「1ステップ実行」層。章編集ステップとコメント編集ステップの本体を担う。
// 状態は毎回 Firestore（原本）から再構築するため冪等・再入可能。次に何をするか（enqueue）は
// orchestrator が決める。構造的検証で不合格の章は failed 記録し原本フォールバック、後続章は継続する。

const db = () => getFirestore();

// 原本章（編集入力）。getChaptersByTopicId は speechMode / factCheck を落とすため、
// 保護対象判定に必要なフィールドを保つ専用リーダーを用意する。
export type RawEditChapter = {
	id: string;
	chapterIndex: number;
	title: string;
	discussionPoints: string[];
	turns: DebateTurn[];
};

type RawChapterDoc = {
	chapterIndex: number;
	title: string;
	discussionPoints?: string[];
	turns?: Array<Partial<DebateTurn> & { id: string; speakerType: string; content: string }>;
};

/** 原本章を chapterIndex 順に、保護対象判定に必要なフィールド（speechMode / factCheck）ごと読み取る */
export const readRawChapters = async (topicId: string): Promise<RawEditChapter[]> => {
	const snap = await db().collection(`topics/${topicId}/chapters`).orderBy('chapterIndex').get();
	return snap.docs.map((docSnap) => {
		const data = docSnap.data() as RawChapterDoc;
		return {
			id: docSnap.id,
			chapterIndex: data.chapterIndex,
			title: data.title,
			discussionPoints: data.discussionPoints ?? [],
			turns: (data.turns ?? []).map((turn) => ({
				id: turn.id,
				speakerType: turn.speakerType,
				personaId: turn.personaId ?? null,
				content: turn.content,
				createdAt: turn.createdAt as DebateTurn['createdAt'],
				speechMode: turn.speechMode,
				factCheck: turn.factCheck
			}))
		};
	});
};

/**
 * 章内で保護対象（除外禁止）となる原本ターンID群を導出する。
 * - speechMode==='fact'（固有の事実的主張）
 * - factCheck に指摘（findings）がある
 * - いずれかのペルソナの気づき（awareness）のトリガーになった（当該章のターンに限る）
 */
export const computeProtectedTurnIds = (
	turns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>
): Set<string> => {
	const chapterTurnIds = new Set(turns.map((turn) => turn.id));
	const protectedIds = new Set<string>();
	for (const turn of turns) {
		if (turn.speechMode === 'fact') protectedIds.add(turn.id);
		if (turn.factCheck && turn.factCheck.findings.length > 0) protectedIds.add(turn.id);
	}
	for (const persona of personas) {
		for (const awareness of persona.awarenesses ?? []) {
			if (chapterTurnIds.has(awareness.triggeredByTurnId)) {
				protectedIds.add(awareness.triggeredByTurnId);
			}
		}
	}
	return protectedIds;
};

/**
 * 編集後ターンドラフト列を原本ターンに対して構造的に検証する（意味検証は行わない）。
 * - 各 sourceTurnId が当該章の原本ターンを指し、重複使用がない（新規発言・分裂・並べ替えの防止）
 * - 連結ターンの sourceTurnIds が同一話者・同一 personaId、ドラフト宣言とも一致
 * - ドラフトの最小由来インデックスが昇順（時系列順序が原本と矛盾しない）
 * - 保護対象ターンがいずれかのドラフトの由来に残る（除外されていない）
 */
export const validateEditedChapter = (
	drafts: ReadonlyArray<EditedTurnDraft>,
	rawTurns: ReadonlyArray<DebateTurn>,
	protectedTurnIds: ReadonlySet<string>
): Result<true, PipelineError> => {
	const fail = (message: string): Result<true, PipelineError> => ({
		ok: false,
		error: { code: 'VALIDATION_ERROR', message }
	});

	const indexById = new Map(rawTurns.map((turn, index) => [turn.id, index]));
	const turnById = new Map(rawTurns.map((turn) => [turn.id, turn]));
	const usedSourceIds = new Set<string>();
	let prevMinIndex = -1;

	for (const draft of drafts) {
		if (draft.sourceTurnIds.length === 0) return fail('sourceTurnIds が空のドラフトがある');
		const indices: number[] = [];
		let speakerType: string | undefined;
		let personaId: string | null | undefined;
		for (const sourceId of draft.sourceTurnIds) {
			const index = indexById.get(sourceId);
			if (index === undefined) return fail(`原本に存在しない sourceTurnId: ${sourceId}`);
			if (usedSourceIds.has(sourceId)) return fail(`sourceTurnId が重複している: ${sourceId}`);
			usedSourceIds.add(sourceId);
			indices.push(index);
			const raw = turnById.get(sourceId)!;
			if (speakerType === undefined) {
				speakerType = raw.speakerType;
				personaId = raw.personaId ?? null;
			} else if (raw.speakerType !== speakerType || (raw.personaId ?? null) !== personaId) {
				// どの話者同士が衝突したかを添えて、機序（ファシリテーター混入か別ペルソナ混入か）を診断可能にする。
				const who = (type: string | undefined, id: string | null | undefined) =>
					type === 'facilitator' ? 'ファシリテーター' : `ペルソナ(${id ?? 'null'})`;
				return fail(
					`連結ターンの話者が食い違う: ${sourceId} は ${who(raw.speakerType, raw.personaId)}、先頭は ${who(speakerType, personaId)}`
				);
			}
		}
		if (draft.speakerType !== speakerType) return fail('ドラフトの speakerType が原本と食い違う');
		if ((draft.personaId ?? null) !== (personaId ?? null)) {
			return fail('ドラフトの personaId が原本と食い違う');
		}
		const minIndex = Math.min(...indices);
		if (minIndex <= prevMinIndex) return fail('時系列順序が原本と矛盾する');
		prevMinIndex = minIndex;
	}

	for (const protectedId of protectedTurnIds) {
		if (!usedSourceIds.has(protectedId)) return fail(`保護対象ターンが除外された: ${protectedId}`);
	}

	return { ok: true, value: true };
};

/** ドラフト列を永続形の編集後ターン列に変換する（新規 id を採番、undefined を混ぜない） */
const toEditedTurns = (drafts: ReadonlyArray<EditedTurnDraft>): EditedTurnForFirestore[] =>
	drafts.map((draft) => ({
		id: nanoid(),
		sourceTurnIds: draft.sourceTurnIds as NonEmptyArray<string>,
		speakerType: draft.speakerType,
		personaId: draft.personaId ?? null,
		content: draft.content,
		...(draft.speechMode ? { speechMode: draft.speechMode } : {})
	}));

/**
 * 章編集ステップ: 対象章をリライトして構造検証し、編集後章を保存する（completed / failed）。
 * LLM 呼び出し失敗は例外として投げ、タスクのリトライに委ねる。構造検証不合格は例外にせず failed 記録して
 * 原本フォールバックさせ、後続章の処理を止めない。次章/コメントへの連鎖は orchestrator が行う。
 * @returns この章の確定ステータス（'completed' | 'failed'）
 */
export const runChapterEditStep = async (
	topicId: string,
	chapterIndex: number,
	_runId: string
): Promise<'completed' | 'failed' | 'skipped'> => {
	const chapters = await readRawChapters(topicId);
	const chapter = chapters[chapterIndex];
	// 原本が存在しない（章が無い／原本ターンが空の）章は編集をスキップする。
	// LLM を呼ばず成果物も書かないため、FE は当該章を missing として原本にフォールバックし、
	// 失敗扱いにしないので完了確定（generated）を妨げない。
	if (!chapter || chapter.turns.length === 0) {
		console.info('[runChapterEditStep] skip: no source turns', { topicId, chapterIndex });
		return 'skipped';
	}
	const personas = (await getPersonasByTopicId(topicId)).filter((persona) => persona.approved);
	const protectedTurnIds = computeProtectedTurnIds(chapter.turns, personas);

	const result = await editChapter(
		{ title: chapter.title, discussionPoints: chapter.discussionPoints, turns: chapter.turns },
		personas,
		protectedTurnIds
	);
	if (!result.ok) throw new Error(pipelineErrorMessage(result.error));

	const validation = validateEditedChapter(result.value, chapter.turns, protectedTurnIds);
	if (!validation.ok) {
		// 構造検証不合格。理由をログと成果物に残し、管理画面での把握・診断に使う（Req 6.4 / Monitoring）。
		const reason = pipelineErrorMessage(validation.error);
		console.warn('[runChapterEditStep] validation failed', {
			topicId,
			chapterId: chapter.id,
			chapterIndex: chapter.chapterIndex,
			reason
		});
		const failed: EditedChapterForFirestore = {
			chapterIndex: chapter.chapterIndex,
			title: chapter.title,
			discussionPoints: chapter.discussionPoints,
			turns: [],
			status: 'failed',
			failureReason: reason
		};
		await writeEditedChapter(topicId, chapter.id, failed);
		return 'failed';
	}

	const completed: EditedChapterForFirestore = {
		chapterIndex: chapter.chapterIndex,
		title: chapter.title,
		discussionPoints: chapter.discussionPoints,
		turns: toEditedTurns(result.value),
		status: 'completed'
	};
	await writeEditedChapter(topicId, chapter.id, completed);
	return 'completed';
};

type RawCommentDoc = { id: string; personaId: string; content: string; sortOrder: number };

/**
 * コメント編集ステップ: 全章編集後に事後コメントをリライトして保存し、編集ランを確定する。
 * コメントが無ければ空成果物を書いて確定する。LLM 失敗は例外（リトライ）。
 * @returns finalizeEditingRun の結果（'generated' | 'stopped' | 'noop'）
 */
export const runCommentsEditStep = async (
	topicId: string,
	runId: string
): Promise<'generated' | 'stopped' | 'noop'> => {
	const snap = await db().doc(`topics/${topicId}/postDebateComments/0`).get();
	const rawComments = snap.exists
		? ((snap.data() as { comments?: RawCommentDoc[] }).comments ?? [])
		: [];

	if (rawComments.length === 0) {
		await writeEditedComments(topicId, { comments: [] });
		return await finalizeEditingRun(topicId, runId);
	}

	const personas = (await getPersonasByTopicId(topicId)).filter((persona) => persona.approved);
	const result = await editComments(rawComments, personas);
	if (!result.ok) throw new Error(pipelineErrorMessage(result.error));

	const sortOrderBySource = new Map(rawComments.map((comment) => [comment.id, comment.sortOrder]));
	const comments: EditedPostDebateCommentForFirestore[] = result.value.map((draft) => ({
		id: nanoid(),
		sourceCommentId: draft.sourceCommentId,
		personaId: draft.personaId,
		content: draft.content,
		sortOrder: sortOrderBySource.get(draft.sourceCommentId) ?? 0
	}));
	await writeEditedComments(topicId, { comments });
	return await finalizeEditingRun(topicId, runId);
};
