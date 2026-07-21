<script lang="ts">
	import DefaultAvatar from '$lib/assets/images/avatars/female_middle_1.png';
	import { firebaseConfig } from '$lib/firebase-config';

	// 外見の解決（配色キー→濃淡・画像 URL の組み立て・欠落時の縮退）をこの部品の中に集約する。
	// 呼び出し側はペルソナを渡すだけで、色や URL を組み立てない。公開・管理で同一のこの部品を使う。
	//
	// 表示に必要な最小形だけを要求する。管理の Persona も公開読み取りモデルのペルソナも
	// 構造的にこれを満たすため、どちらのサーフェスも自分の型のまま渡せる。
	interface Props {
		persona?: {
			id: string;
			topicId: string;
			colorKey?: string;
			avatarGeneratedAt?: Date;
		} | null;
	}
	let { persona }: Props = $props();

	// 配色キー→濃淡の対応。ここがデザイン調整点で、ペルソナデータを変えずにここだけで変更できる。
	// ペルソナに解決できない話者（ファシリテーター）と配色キー欠落は無彩色の既定へ倒し、
	// パレット系統を消費しない。
	const colorKey = $derived(persona?.colorKey ?? 'base');
	const silhouetteColor = $derived(`var(--${colorKey}-600)`);
	const backgroundColor = $derived(`var(--${colorKey}-100-transparent)`);

	// パスはペルソナの id と topicId から常に導出できるため保存しない。
	// avatarGeneratedAt は存在フラグ兼キャッシュバスターで、再生成後に古い画像が出ないようにする。
	// 未生成・失敗（未設定）のときは既定アバターへ縮退する。
	const src = $derived.by(() => {
		if (!persona?.avatarGeneratedAt) return DefaultAvatar;
		const path = encodeURIComponent(`topics/${persona.topicId}/avatars/${persona.id}`);
		return `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${path}?alt=media&v=${persona.avatarGeneratedAt.getTime()}`;
	});
</script>

<div class="persona-avatar" style:--persona-avatar-background-color={backgroundColor}>
	<div
		class="persona-avatar__image"
		style:--persona-avatar-silhouette-color={silhouetteColor}
		style:--persona-avatar-src={`url(${src})`}
	></div>
</div>

<style>
	.persona-avatar {
		width: 64px;
		height: 64px;
		background: var(--persona-avatar-background-color);
		border-radius: 24px;
		overflow: hidden;
	}

	.persona-avatar__image {
		width: 100%;
		height: 100%;
		/* アルファをマスクにした単色塗り。背景色はコンテナ側に分離し、2色を独立させる */
		background-color: var(--persona-avatar-silhouette-color);
		mask-image: var(--persona-avatar-src);
		mask-mode: alpha;
		mask-size: contain;
		mask-position: center;
		mask-repeat: no-repeat;
	}
</style>
