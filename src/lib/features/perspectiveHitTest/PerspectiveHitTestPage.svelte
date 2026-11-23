<script lang="ts">
	/*
	 * perspective と当たり判定の切り分け用ページ。
	 * 公開トップの円が「中央ジャストのときしかクリックできない」問題を、
	 * 最小構成で再現・切り分けるために置いている。要因は 1 つずつ切り替える。
	 */
	let useDepth = $state(true);
	let usePerspective = $state(true);
	let usePreserve3d = $state(true);
	let useFilter = $state(false);
	let use2dShift = $state(false);
	let perspectiveOnScroller = $state(true);

	let clicked = $state<string[]>([]);

	const circles = Array.from({ length: 12 }, (_, index) => index + 1);

	const record = (label: number) => {
		clicked = [`${label}`, ...clicked].slice(0, 8);
	};
</script>

<svelte:head>
	<title>perspective と当たり判定の切り分け — logotope</title>
</svelte:head>

<div class="perspective-hit-test-page">
	<div class="perspective-hit-test-page__controls">
		<label><input type="checkbox" bind:checked={useDepth} /> translateZ を掛ける</label>
		<label><input type="checkbox" bind:checked={usePerspective} /> perspective を掛ける</label>
		<label><input type="checkbox" bind:checked={usePreserve3d} /> preserve-3d を掛ける</label>
		<label><input type="checkbox" bind:checked={useFilter} /> filter を掛ける</label>
		<label>
			<input type="checkbox" bind:checked={use2dShift} /> 2D の translate + scale を掛ける
		</label>
		<label>
			<input type="checkbox" bind:checked={perspectiveOnScroller} /> perspective をスクローラ自身に置く
		</label>
		<p class="perspective-hit-test-page__log">
			クリックできた円: {clicked.join(', ') || 'まだ無し'}
		</p>
	</div>

	<div
		class="perspective-hit-test-page__scroller"
		class:perspective-hit-test-page__scroller--perspective={usePerspective && perspectiveOnScroller}
	>
		<div
			class="perspective-hit-test-page__stage"
			class:perspective-hit-test-page__stage--perspective={usePerspective && !perspectiveOnScroller}
		>
			<ul
				class="perspective-hit-test-page__list"
				class:perspective-hit-test-page__list--preserve={usePreserve3d}
			>
				{#each circles as circle (circle)}
					<li
						class="perspective-hit-test-page__row"
						class:perspective-hit-test-page__row--preserve={usePreserve3d}
					>
						<button
							type="button"
							class="perspective-hit-test-page__circle"
							class:perspective-hit-test-page__circle--depth={useDepth}
							class:perspective-hit-test-page__circle--filter={useFilter}
							class:perspective-hit-test-page__circle--shift={use2dShift}
							onclick={() => record(circle)}
						>
							{circle}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</div>

<style>
	.perspective-hit-test-page {
		display: grid;
		grid-template-columns: 20rem 1fr;
		block-size: 100dvh;
		background: #1b1b2b;
		color: #fff;
	}

	.perspective-hit-test-page__controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.5rem;
		font-size: 0.875rem;
	}

	.perspective-hit-test-page__log {
		margin: 0;
		padding-block-start: 1rem;
	}

	.perspective-hit-test-page__scroller {
		overflow-y: auto;
		min-block-size: 0;
		container-type: size;
	}

	.perspective-hit-test-page__scroller--perspective,
	.perspective-hit-test-page__stage--perspective {
		perspective: 2000px;
	}

	.perspective-hit-test-page__list {
		list-style: none;
		margin: 0;
		padding-inline: 0;
		padding-block: calc(50cqb - 10rem);
	}

	.perspective-hit-test-page__list--preserve,
	.perspective-hit-test-page__row--preserve {
		transform-style: preserve-3d;
	}

	.perspective-hit-test-page__row {
		block-size: 7rem;
		/* 3D 変換した行に判定を奪わせない */
		pointer-events: none;
	}

	.perspective-hit-test-page__circle {
		display: block;
		box-sizing: border-box;
		inline-size: 20rem;
		aspect-ratio: 1;
		border: none;
		border-radius: 50%;
		margin-inline: auto;
		background: #fafafa;
		color: #1b1b2b;
		font-size: 2rem;
		cursor: pointer;
		pointer-events: auto;
	}

	.perspective-hit-test-page__circle--depth {
		animation: perspective-hit-test-page-depth ease-in-out both;
		animation-timeline: view();
		animation-range: cover 0% cover 100%;
	}

	.perspective-hit-test-page__circle--filter {
		filter: blur(0);
	}

	/* 3D を使わずに、大きさと位置を動かす。表示と当たり判定がずれないかを見る */
	.perspective-hit-test-page__circle--shift {
		animation: perspective-hit-test-page-shift ease-in-out both;
		animation-timeline: view();
		animation-range: cover 0% cover 100%;
	}

	@keyframes perspective-hit-test-page-shift {
		0% {
			scale: 0.625;
			translate: 0 -12rem;
		}
		50% {
			scale: 1;
			translate: 0 0;
		}
		100% {
			scale: 0.625;
			translate: 0 12rem;
		}
	}

	@keyframes perspective-hit-test-page-depth {
		0% {
			translate: 0 0 -1200px;
		}
		50% {
			translate: 0 0 0;
		}
		100% {
			translate: 0 0 -1200px;
		}
	}
</style>
