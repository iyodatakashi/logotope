<script lang="ts">
	import DefaultAvatar from '$lib/assets/images/avatars/female_middle_1.png';

	// src: 被写体=不透明・顔の内側/背景=透明 のアルファ透過PNG（import 済みURL）
	// silhouetteColor / backgroundColor: 独立に指定する2色（値はプロジェクト側のトークン）
	let {
		src = DefaultAvatar,
		silhouetteColor = 'var(--scarlet-600)',
		backgroundColor = 'var(--scarlet-100-transparent)'
	}: {
		src?: string;
		silhouetteColor?: string;
		backgroundColor?: string;
	} = $props();
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
