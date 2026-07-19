<script lang="ts">
	import AvatarImage from '$lib/assets/images/30_female_20.png';
</script>

<div class="persona-avatar">
	<div class="persona-avatar__image" style:--persona-avatar-src={`url(${AvatarImage})`}></div>
</div>

<style>
	.persona-avatar {
		width: 64px;
		height: 64px;
		background: var(--blue-100-transparent);
		border-radius: 24px;
		overflow: hidden;
	}

	.persona-avatar__image {
		width: 100%;
		height: 100%;
		/* 白黒アセットの黒い部分（＝被写体）をこの色で塗る。値はプロジェクト側で指定する */
		background-color: var(--blue-600);
		mix-blend-mode: multiply;
		/* 白背景の不透明PNGをそのまま形として使うため、luminanceマスクを反転する。
		   白いグラデ（全面表示）から画像の輝度を引き、黒い被写体だけを残す */
		mask-image: linear-gradient(#fff, #fff), var(--persona-avatar-src);
		mask-mode: luminance;
		mask-composite: subtract;
		mask-size: cover, contain;
		mask-position: center;
		mask-repeat: no-repeat;
	}
</style>
