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

<div class="probe">
	<div class="probe__controls">
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
		<p class="probe__log">クリックできた円: {clicked.join(', ') || 'まだ無し'}</p>
	</div>

	<div
		class="probe__scroller"
		class:probe__scroller--perspective={usePerspective && perspectiveOnScroller}
	>
		<div
			class="probe__stage"
			class:probe__stage--perspective={usePerspective && !perspectiveOnScroller}
		>
			<ul class="probe__list" class:probe__list--preserve={usePreserve3d}>
				{#each circles as circle (circle)}
					<li class="probe__row" class:probe__row--preserve={usePreserve3d}>
						<button
							type="button"
							class="probe__circle"
							class:probe__circle--depth={useDepth}
							class:probe__circle--filter={useFilter}
							class:probe__circle--shift={use2dShift}
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
	.probe {
		display: grid;
		grid-template-columns: 20rem 1fr;
		block-size: 100dvh;
		background: #1b1b2b;
		color: #fff;
	}

	.probe__controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.5rem;
		font-size: 0.875rem;
	}

	.probe__log {
		margin: 0;
		padding-block-start: 1rem;
	}

	.probe__scroller {
		overflow-y: auto;
		min-block-size: 0;
		container-type: size;
	}

	.probe__scroller--perspective,
	.probe__stage--perspective {
		perspective: 2000px;
	}

	.probe__list {
		list-style: none;
		margin: 0;
		padding-inline: 0;
		padding-block: calc(50cqb - 10rem);
	}

	.probe__list--preserve,
	.probe__row--preserve {
		transform-style: preserve-3d;
	}

	.probe__row {
		block-size: 7rem;
		/* 3D 変換した行に判定を奪わせない */
		pointer-events: none;
	}

	.probe__circle {
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

	.probe__circle--depth {
		animation: probe-depth ease-in-out both;
		animation-timeline: view();
		animation-range: cover 0% cover 100%;
	}

	.probe__circle--filter {
		filter: blur(0);
	}

	/* 3D を使わずに、大きさと位置を動かす。表示と当たり判定がずれないかを見る */
	.probe__circle--shift {
		animation: probe-shift ease-in-out both;
		animation-timeline: view();
		animation-range: cover 0% cover 100%;
	}

	@keyframes probe-shift {
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

	@keyframes probe-depth {
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
