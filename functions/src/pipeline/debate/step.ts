/**
 * 討論チェーンの「1ステップ実行」層。
 *
 * 各 stepKind（open / turn / summary / closing / comments）の処理本体を担い、
 * 自分のステップの生成・冪等追記だけを行って「実行結果」を返す。次に何をするか
 * （decideNextStep の呼び出しや enqueue）はこの層では決めず、チェーン駆動層
 * （debate-orchestrator.ts）が dispatch した stepKind と実行結果から決める。
 *
 * この一方向（orchestrator → step）により、step 層は debate-orchestrator.ts に依存しない。
 * handler は受け取った ctx・options のみで実行し、ctx.state を破壊的に更新する。
 * その更新後の状態を基に orchestrator が次ステップを enqueue する（frontier 算出も orchestrator 側）。
 */
import { updateChapterStatus } from './chapter.js';
import { getTopicContext } from '../topics/topic-context.js';
import { generateOpening, generateChapterIntroduction } from '../../agents/facilitator-agent.js';
import { selectSpeaker } from './speaker-selection.js';
import { CONTINUE_CHAPTER_THRESHOLD } from '../../constants/debate.constants.js';
import {
	evaluateEngagements,
	evaluateEngagementWithFallback,
	evaluateReactionsForCommittedTurn
} from './engagement.js';
import { expireQueuedIntents, addQueuedIntents, consumeQueuedIntent } from './queued-intents.js';
import {
	initAgendaItems,
	markIntroduced,
	saveAgendaItemStatuses,
	deleteAgendaItemStatuses,
	getActiveAgendaItem
} from './agenda.js';
import { progressAgenda } from './intervention.js';
import { updateSpeakerStats } from './debate-state.js';
import { generateFacilitatorTurn, generatePersonaTurn } from './turn.js';
import type { PersonaTurnCommit } from './turn.js';
import { setPendingTurn, clearPendingTurn } from './pending-turn.js';
import { nanoid } from 'nanoid';
import { pipelineErrorMessage, validPersonaId, isEarlyEndCandidate } from './utils.js';
import type {
	SpeakerSelection,
	DebateState,
	DebateOptions,
	Engagement
} from '../../types/debate.types.js';
import type { DebateTurn, AppendResult } from '../../types/turn.types.js';
import type { StepPayload, StepContext, TurnExecution } from '../../types/step.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';
import { getFirestore } from 'firebase-admin/firestore';

const db = () => getFirestore();

/**
 * executeTurn の結果。committed は quietStreak を、rejected は追記棄却理由を、skipped は停止を表す（R9.2）。
 * chapter-exhausted は最後の論点が出尽くし・発言なしで addressed のみ立てた状態（committed-no-turn）を表し、
 * 余計なペルソナ発言を挟まず章終了へ渡すシグナル。
 */
type ExecuteTurnResult =
	| { status: 'committed'; quietStreak: number }
	| { status: 'chapter-exhausted'; quietStreak: number }
	| Extract<AppendResult, { status: 'rejected' }>
	| { status: 'skipped' };

/** 末尾ターンが誰かを指名（直接質問）していれば、その指名先と指名元を返す。なければ undefined */
const getLastTargetPersona = (
	turns: DebateTurn[]
): { personaId: string; targetedBy: 'facilitator' | 'persona' } | undefined => {
	const last = turns[turns.length - 1];
	if (!last?.targetPersonaId || !last.targetedBy) return undefined;
	return { personaId: last.targetPersonaId, targetedBy: last.targetedBy };
};

/**
 * 発言コミット後の共通後処理: 消化したキューを除去 → 発言統計を更新。
 * executeTurn の freeze 分岐と通常分岐の両方から、コミット成功時に同一の手順で呼ぶ。
 * 論点ステータスの永続は遷移発生箇所（progressAgenda / open ステップ）に一本化する。
 */
const finalizeCommittedTurn = async ({
	topicId,
	chapterId,
	state,
	personas,
	reply
}: {
	topicId: string;
	chapterId: string;
	state: DebateState;
	personas: Persona[];
	reply: PersonaTurnCommit;
}): Promise<void> => {
	await consumeQueuedIntent({
		topicId,
		chapterId,
		state,
		personaId: reply.personaId,
		queuedEntries: reply.queuedEntries
	});
	updateSpeakerStats({ state, personas, personaId: reply.personaId });
};

/**
 * コミット済みターンへの末尾評価（反応の永続＋当該ターンの status='evaluating' 終了）を実行する。
 * best-effort：失敗しても討論は止めず、次ステップ/章末の自己修復で反応永続＋status 終了が回復する（3.5/3.7）。
 */
/** 発言意欲・意図の判定に渡す「いま場に出ている論点」。未提示時は章タイトルを場のテーマとして用いる。 */
const resolveActiveFocus = (state: DebateState, chapter: Chapter): string =>
	getActiveAgendaItem(state) ?? chapter.title;

const runEndEvaluation = async (params: {
	topicId: string;
	chapterId: string;
	committedTurnId: string;
	personas: Persona[];
	chapterTurns: ReadonlyArray<DebateTurn>;
	activeAgendaItem: string;
	runId?: string;
}): Promise<void> => {
	try {
		await evaluateReactionsForCommittedTurn(params);
	} catch (err) {
		console.error(`[end-eval] failed for turn ${params.committedTurnId}: ${err}`);
	}
};

/**
 * 盛り上がり判定: 高意欲者がいれば連続カウントを 0 リセット、いなければ +1（早期終了に近づく）。
 * engagements から純粋に次 quietStreak を算出する（算出式は不変）。
 */
const decideQuietStreak = (engagements: Engagement[], quietStreak: number): number => {
	const shouldContinue =
		engagements.length === 0 ||
		engagements.some((engagement) => engagement.score >= CONTINUE_CHAPTER_THRESHOLD);
	return shouldContinue ? 0 : quietStreak + 1;
};

/**
 * 章末 +1 最終応答ターンを実行する（freeze パス）。旧ループの章末ブロックと等価で、
 * 話者選択・介入・キュー更新を挟まず、末尾の未応答指名先にそのまま1回だけ答えさせる簡略フロー。
 * quietStreak は据え置く。
 */
const executeFinalResponseTurn = async ({
	topicId,
	topicTitle,
	personas,
	chapter,
	chapterId,
	state,
	chapterTurnStartInState,
	quietStreak,
	targetPersona
}: {
	topicId: string;
	topicTitle: string;
	personas: Persona[];
	chapter: Chapter;
	chapterId: string;
	state: DebateState;
	chapterTurnStartInState: number;
	quietStreak: number;
	targetPersona: { personaId: string; targetedBy: 'facilitator' | 'persona' };
}): Promise<ExecuteTurnResult> => {
	const speakerSelection: SpeakerSelection = {
		personaId: targetPersona.personaId,
		reason:
			targetPersona.targetedBy === 'facilitator' ? 'targeted_by_facilitator' : 'targeted_by_persona'
	};
	// 章末 +1 は話者が指名で確定済み。全非話者の一括評価（evaluateEngagements）は
	// 話者選択・キュー・終了判定・気づき検出のいずれにも使われず捨てられるため廃し、
	// 指名者のみ単独評価する（2.1）。非指名者の評価・awareness 捕捉はこのターンでは行わない。
	const engagement = await evaluateEngagementWithFallback({
		topicId,
		personaId: speakerSelection.personaId,
		personas,
		chapterTurns: state.turns.slice(chapterTurnStartInState),
		activeAgendaItem: resolveActiveFocus(state, chapter)
	});
	const reply = await generatePersonaTurn({
		topicId,
		topicTitle,
		personas,
		chapter,
		state,
		speakerSelection,
		engagement,
		chapterTurnStartIndex: chapterTurnStartInState,
		progressPatch: { quietStreak } // freeze 中は quietStreak を据え置く
	});
	// 追記棄却（世代不一致・並走敗者）・討論停止は理由を保持して返す（R9.2）
	if (reply.status !== 'committed') return reply;
	await finalizeCommittedTurn({ topicId, chapterId, state, personas, reply });
	// 章末最終応答（freeze）ターンにも末尾評価を実施し、従来のスキップを撤回する（1.6）
	await runEndEvaluation({
		topicId,
		chapterId,
		committedTurnId: reply.turnId,
		personas,
		chapterTurns: state.turns.slice(chapterTurnStartInState),
		activeAgendaItem: resolveActiveFocus(state, chapter),
		runId: state.runId
	});
	return { status: 'committed', quietStreak };
};

/**
 * 1ターンを実行する（旧 while ループの executeTurn に相当）。話者選択・介入・発言生成・
 * 永続化・統計更新までを担う。quietStreak を継続シグナルから決め、追記と同一トランザクションで書き込む。
 * freeze=true（章末 +1 最終応答）のときは最終応答パス（executeFinalResponseTurn）へ委譲する。
 */
const executeTurn = async ({
	topicId,
	topicTitle,
	personas,
	chapter,
	chapterId,
	state,
	chapterTurnStartInState,
	interventionCooldown,
	quietStreak,
	freeze
}: {
	topicId: string;
	topicTitle: string;
	personas: Persona[];
	chapter: Chapter;
	chapterId: string;
	state: DebateState;
	chapterTurnStartInState: number;
	interventionCooldown: number;
	quietStreak: number;
	freeze: boolean;
}): Promise<ExecuteTurnResult> => {
	// この章ぶんのターン列を切り出すヘルパ（state.turns は全章を含むため）
	const getChapterTurns = (): DebateTurn[] => state.turns.slice(chapterTurnStartInState);
	// 末尾ターンが誰かを指名していれば、その指名先（次に応答すべき人）
	const targetPersona = getLastTargetPersona(state.turns);

	// 自己修復: 直前確定ターンの反応が未永続なら末尾評価し、残った evaluating を終了させる（3.5/3.7）。
	// 通常は既に永続済みで reuse による読み取りに退化する（追加 LLM なし）。
	const priorChapterTurns = getChapterTurns();
	const priorTurn = priorChapterTurns[priorChapterTurns.length - 1];
	if (priorTurn) {
		await runEndEvaluation({
			topicId,
			chapterId,
			committedTurnId: priorTurn.id,
			personas,
			chapterTurns: priorChapterTurns,
			activeAgendaItem: resolveActiveFocus(state, chapter),
			runId: state.runId
		});
	}

	// 章末 +1 最終応答は専用パスへ委譲する（話者選択・介入・キュー更新を挟まない簡略フロー）
	if (freeze && targetPersona) {
		return executeFinalResponseTurn({
			topicId,
			topicTitle,
			personas,
			chapter,
			chapterId,
			state,
			chapterTurnStartInState,
			quietStreak,
			targetPersona
		});
	}

	// --- 通常ターン ---
	// 失効したキューを掃除し、全ペルソナの意欲を評価する
	await expireQueuedIntents({ topicId, chapterId, state });
	const engagements = await evaluateEngagements({
		topicId,
		chapterId,
		personas,
		state,
		chapterTurns: getChapterTurns(),
		activeAgendaItem: resolveActiveFocus(state, chapter)
	});

	// ファシリテーター介入を常時委譲する。末尾の指名状態（指名なし・ペルソナ間指名・ファシリテーター指名）に
	// 関わらず、単一クールダウンで進行評価を1回行う。クールダウン判定は progressAgenda 内で自己完結し、
	// ファシリテーター発言直後はペルソナターン数 0 で自然にスキップされる。介入は継続扱いで quietStreak を 0 にする。
	const progress = await progressAgenda({
		topicId,
		personas,
		chapter,
		chapterId,
		state,
		engagements,
		interventionCooldown,
		chapterTurns: getChapterTurns(),
		chapterTurnStartIndex: chapterTurnStartInState,
		progressPatch: { quietStreak: 0 }
	});
	if (progress === 'intervened') {
		await saveAgendaItemStatuses(topicId, chapterId, state);
		return { status: 'committed', quietStreak: 0 };
	}
	if (progress === 'chapter-exhausted') {
		// 最後の論点が出尽くし・発言なし（addressed のみ永続済み）。ペルソナ発言を挟まず章終了へ渡す
		return { status: 'chapter-exhausted', quietStreak };
	}

	// 次の話者を決定（指名 > キュー > スコア）し、選ばれなかった意欲者の意図はキューに積む
	const speakerSelection = selectSpeaker({ targetPersona, engagements, state, personas });
	await addQueuedIntents({
		topicId,
		chapterId,
		state,
		engagements,
		speakerSelection,
		triggerTurnId: state.turns[state.turns.length - 1]?.id ?? ''
	});
	// 選ばれた話者の意欲（一括評価に無ければ個別評価）を取得する
	const engagement = await evaluateEngagementWithFallback({
		topicId,
		personaId: speakerSelection.personaId,
		personas,
		chapterTurns: getChapterTurns(),
		activeAgendaItem: resolveActiveFocus(state, chapter),
		engagements
	});
	const nextEndCount = decideQuietStreak(engagements, quietStreak);

	const reply = await generatePersonaTurn({
		topicId,
		topicTitle,
		personas,
		chapter,
		state,
		speakerSelection,
		engagement,
		chapterTurnStartIndex: chapterTurnStartInState,
		progressPatch: { quietStreak: nextEndCount }
	});
	// 追記棄却（世代不一致・並走敗者）・討論停止は理由を保持して返す（R9.2）
	if (reply.status !== 'committed') return reply;
	await finalizeCommittedTurn({ topicId, chapterId, state, personas, reply });
	// 発言確定後の共通後処理の直後に、確定ターン自身への末尾評価を実行する（次ターンは reuse で読むだけ・1.1/1.4）
	await runEndEvaluation({
		topicId,
		chapterId,
		committedTurnId: reply.turnId,
		personas,
		chapterTurns: getChapterTurns(),
		activeAgendaItem: resolveActiveFocus(state, chapter),
		runId: state.runId
	});
	return { status: 'committed', quietStreak: nextEndCount };
};

/**
 * open ステップ: オープニング/導入のファシリテーターターンを追記する。
 * @returns 開始処理を行ったか（既に開始済み/完了で何もしなければ false）。次の turn 投入は orchestrator が行う。
 */
export const performOpenStep = async (ctx: StepContext, payload: StepPayload): Promise<boolean> => {
	const { chapterDoc, chapter, personas, topicTitle, state, chapterTurnStartInState } = ctx;
	const { topicId, chapterIndex } = payload;

	// 章が空のときのみ開始処理する。既に開始済み/完了なら何もしない（orchestrator が turn を投入して resume）
	if (chapterDoc.turns.length !== 0 || chapterDoc.status === 'completed') {
		return false;
	}

	// 章を running にし、論点をすべて untouched で初期化して保存する
	await updateChapterStatus(topicId, chapterDoc.id, 'running');
	state.agenda = initAgendaItems(chapter);
	await saveAgendaItemStatuses(topicId, chapterDoc.id, state);

	// 事実基盤（共通前提）はサーバ権威の getTopicContext で供給し、ファシリテーターの導入に背景として渡す（R8.1）。
	const { factBase } = await getTopicContext(topicId);

	// 生成中スケルトン: ファシリテーター発言の生成開始を pendingTurn（personaId なし＝ファシリテーター）で示す。
	// コミット時は addTurn が pendingTurn を自動削除し、未コミット（失敗・棄却）でも finally で確実にクリアする。
	const facilitatorPendingId = nanoid();
	await setPendingTurn({
		topicId,
		chapterId: chapterDoc.id,
		pendingTurn: {
			id: facilitatorPendingId,
			expectedTurnIndex: state.turns.length - chapterTurnStartInState,
			status: 'generating'
		}
	});
	try {
		// 第1章は討論全体のオープニング、それ以外は章の導入をファシリテーターに生成させる
		if (chapterIndex === 0) {
			const openingResult = await generateOpening(topicTitle, personas, chapter, factBase);
			if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));
			const fac = await generateFacilitatorTurn({
				topicId,
				state,
				chapterId: chapterDoc.id,
				content: openingResult.value.content ?? '',
				targetPersonaId: validPersonaId(openingResult.value.targetPersonaId, personas),
				chapterTurnStartIndex: chapterTurnStartInState
			});
			if (fac.status === 'committed') {
				markIntroduced(state, openingResult.value.selectedAgendaItemIndex);
				await saveAgendaItemStatuses(topicId, chapterDoc.id, state);
				// オープニング確定後に末尾評価し、最初のペルソナ発言の話者選択が反応を読める状態にする（1.5）
				await runEndEvaluation({
					topicId,
					chapterId: chapterDoc.id,
					committedTurnId: fac.id,
					personas,
					chapterTurns: state.turns.slice(chapterTurnStartInState),
					activeAgendaItem: resolveActiveFocus(state, chapter),
					runId: state.runId
				});
			}
		} else {
			const introResult = await generateChapterIntroduction(chapter, personas, factBase);
			if (introResult.ok) {
				const fac = await generateFacilitatorTurn({
					topicId,
					state,
					chapterId: chapterDoc.id,
					content: introResult.value.content ?? '',
					targetPersonaId: validPersonaId(introResult.value.targetPersonaId, personas),
					chapterTurnStartIndex: chapterTurnStartInState
				});
				if (fac.status === 'committed') {
					markIntroduced(state, introResult.value.selectedAgendaItemIndex);
					await saveAgendaItemStatuses(topicId, chapterDoc.id, state);
					// 章の導入確定後にも末尾評価し、最初のペルソナ発言の話者選択が反応を読める状態にする（1.5）
					await runEndEvaluation({
						topicId,
						chapterId: chapterDoc.id,
						committedTurnId: fac.id,
						personas,
						chapterTurns: state.turns.slice(chapterTurnStartInState),
						activeAgendaItem: resolveActiveFocus(state, chapter),
						runId: state.runId
					});
				}
			}
		}
	} finally {
		// コミット済みなら addTurn が削除済み（compare-and-clear は id 不一致で no-op）。未コミットはここで消す。
		await clearPendingTurn({ topicId, chapterId: chapterDoc.id, id: facilitatorPendingId });
	}

	return true;
};

/**
 * 早期終了の手前で継続保護を効かせる（非LLM）。
 * 盛り上がりが落ちて早期終了しそうでも、未消化の論点が残る間は quietStreak を 0 に戻して章を続行させる
 * （取りこぼし防止）。消化(addressed)判定は出尽くし判断由来に一本化したため、ここでは LLM を呼ばず
 * 永続状態のみを見る。全論点 addressed（または論点なし章）なら従来どおり早期終了を許す。補正後の quietStreak を返す。
 */
const reconcileEarlyEndCoverage = async ({
	topicId,
	chapterId,
	state,
	chapterTurnStartInState,
	turnsPerChapter,
	quietStreak
}: {
	topicId: string;
	chapterId: string;
	state: DebateState;
	chapterTurnStartInState: number;
	turnsPerChapter: number;
	quietStreak: number;
}): Promise<number> => {
	const chapterTurnCountNow = state.turns.length - chapterTurnStartInState;
	if (!isEarlyEndCandidate(chapterTurnCountNow, turnsPerChapter, quietStreak)) {
		return quietStreak;
	}
	// 未消化が残るなら早期終了を取り消して継続（quietStreak リセット）
	if (state.agenda.some((agendaItem) => agendaItem.status !== 'addressed')) {
		await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({ quietStreak: 0 });
		return 0;
	}
	return quietStreak;
};

/**
 * turn ステップ: frontier 一致なら1ターン生成→冪等追記し、実行結果を返す。
 * 不一致（既に前進済み）は advanced、並走敗者・停止は conflict、世代交代検出は stale_generation、
 * 章完了済みは completed を返す。次ステップの決定・投入は orchestrator が本結果と payload.finalResponse から行う。
 */
export const performTurnStep = async (
	ctx: StepContext,
	payload: StepPayload,
	options: DebateOptions
): Promise<TurnExecution> => {
	const { chapterDoc, chapter, personas, topicTitle, state, chapterTurnStartInState, quietStreak } =
		ctx;
	const { topicId } = payload;
	const chapterLocalCount = chapterDoc.turns.length;
	const freeze = !!payload.finalResponse; // 章末 +1 最終応答は quietStreak を据え置く

	if (chapterDoc.status === 'completed') return { status: 'completed' };

	// frontier 不一致（並走の敗者・既に前進済み）→ 生成しない。orchestrator が次ステップへ進める
	if (chapterLocalCount !== payload.expectedTurnIndex) {
		return { status: 'advanced', quietStreak };
	}

	const result = await executeTurn({
		topicId,
		topicTitle,
		personas,
		chapter,
		chapterId: chapterDoc.id,
		state,
		chapterTurnStartInState,
		interventionCooldown: options.interventionCooldown,
		quietStreak,
		freeze
	});
	// 生成中に世代交代が起きて addTurn が弾いた場合は、旧世代タスクなので resume させない（R9.2/9.3）
	if (result.status === 'rejected' && result.reason === 'generation_mismatch') {
		return { status: 'stale_generation' };
	}
	// 最後の論点が出尽くし・発言なし（committed-no-turn）。終了判定は orchestrator に委ね、reconcile は不要
	if (result.status === 'chapter-exhausted') {
		return { status: 'chapter-exhausted', quietStreak: result.quietStreak };
	}
	// 並走敗者（index_mismatch）・討論停止（skipped）は従来どおり conflict → resumeFromFresh
	if (result.status !== 'committed') return { status: 'conflict' };

	// 最終応答（+1）の直後は次ステップ判定を再評価せず、そのまま章末へ進む（orchestrator が判断）
	if (freeze) return { status: 'advanced', quietStreak: result.quietStreak };

	// 早期終了の手前で論点カバレッジを再確認・補正し、確定した quietStreak を得る
	const finalEndCount = await reconcileEarlyEndCoverage({
		topicId,
		chapterId: chapterDoc.id,
		state,
		chapterTurnStartInState,
		turnsPerChapter: options.turnsPerChapter,
		quietStreak: result.quietStreak
	});

	// 確定した quietStreak を実行結果に載せる。これを基に orchestrator が次ステップを決める
	return { status: 'advanced', quietStreak: finalEndCount };
};

/**
 * 章完了ステップ: 章末（chapter-end）で当該章を completed に確定し、論点状態をクリーンアップする。
 * 発言生成は一切行わない。状態は Firestore から再構築するため completed 再適用に対し冪等。
 * @returns 常に true。次段（次章 open / 最終章の generated 確定）の投入は orchestrator が行う。
 */
export const completeChapterStep = async (
	ctx: StepContext,
	payload: StepPayload
): Promise<boolean> => {
	const { chapterDoc, chapter, personas, state } = ctx;
	const { topicId } = payload;
	// completed 確定前に、最終ターンの反応が未永続なら末尾評価する（evaluating を残さない・reuse で退化・3.3/3.7）
	const finalTurn = chapterDoc.turns[chapterDoc.turns.length - 1];
	if (finalTurn) {
		await runEndEvaluation({
			topicId,
			chapterId: chapterDoc.id,
			committedTurnId: finalTurn.id,
			personas,
			chapterTurns: chapterDoc.turns,
			activeAgendaItem: resolveActiveFocus(state, chapter),
			runId: state.runId
		});
	}
	await updateChapterStatus(topicId, chapterDoc.id, 'completed');
	await deleteAgendaItemStatuses(topicId, chapterDoc.id);
	return true;
};
