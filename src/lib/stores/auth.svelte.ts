import type { User } from 'firebase/auth';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '$lib/firebase';

let user = $state<User | null>(null);
let loading = $state(true);

if (typeof window !== 'undefined') {
	onAuthStateChanged(auth, (firebaseUser) => {
		user = firebaseUser;
		loading = false;
	});
}

export const authStore = {
	get user() {
		return user;
	},
	get loading() {
		return loading;
	},
	get isLoggedIn() {
		return user !== null;
	},

	async login(email: string, password: string): Promise<void> {
		await signInWithEmailAndPassword(auth, email, password);
	},

	async logout(): Promise<void> {
		await signOut(auth);
	},

	async getIdToken(): Promise<string | null> {
		return user?.getIdToken() ?? null;
	}
};
