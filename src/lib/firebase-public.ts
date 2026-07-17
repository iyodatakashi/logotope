import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const publicDb = getFirestore(app);

if (typeof window !== 'undefined' && import.meta.env.VITE_USE_EMULATOR === 'true') {
	connectFirestoreEmulator(publicDb, 'localhost', 8080);
}
