<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '@14ch/svelte-ui/styles';
	import '$lib/assets/styles/import.scss';
	import { Snackbar } from '@14ch/svelte-ui';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<Snackbar />
