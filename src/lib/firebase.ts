import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { firebaseConfig } from './firebase-config';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'asia-northeast1');

if (typeof window !== 'undefined' && import.meta.env.VITE_USE_EMULATOR === 'true') {
	connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
	connectFirestoreEmulator(db, 'localhost', 8080);
	connectFunctionsEmulator(functions, 'localhost', 5001);
}
