import { createContext, onDestroy, onMount } from 'svelte';
import { createHighlighter, type Highlighter } from 'shiki/bundle/web';

class ShikiStore {
	private highlighterPromise = createHighlighter({
		themes: ['dark-plus', 'light-plus'],
		langs: ['bash', 'json']
	});

	highlighter = $state<Highlighter | null>(null);

	constructor() {
		onMount(async () => {
			this.highlighter = await this.highlighterPromise;
		});
		onDestroy(() => {
			this.highlighter?.dispose();
		});
	}
}

const [internalGet, internalSet] = createContext<ShikiStore>();

export const getShikiStore = () => {
	const store = internalGet();
	if (!store) {
		throw new Error('ShikiStore not found, did you call setShikiStore() in a parent component?');
	}
	return store;
};

export const setShikiStore = () => {
	const newStore = new ShikiStore();
	return internalSet(newStore);
};
