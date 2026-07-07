/**
 * テスト用の最小インメモリ Firestore。doc/collection/runTransaction と
 * FieldValue.delete / arrayUnion、set({merge}) を支える。冪等性・liveness・行動等価性の
 * 統合テストで、ステップ間の状態再構築が永続データを正しく読み戻せることを検証するために使う。
 */
export type DocData = Record<string, unknown>;

const DELETE_SENTINEL = Symbol('FieldValue.delete');

type ArrayUnion = { __arrayUnion: unknown[] };
const isArrayUnion = (v: unknown): v is ArrayUnion =>
	!!v && typeof v === 'object' && '__arrayUnion' in (v as object);

export const createFirestoreMock = () => {
	const store = new Map<string, DocData>();
	const lastSeg = (p: string) => p.split('/').pop() as string;

	// ドット区切りキー（例: "impressions.p1"）は Firestore のフィールドパス同様、ネストして書き込む。
	const setNested = (root: DocData, dotted: string, value: unknown) => {
		const keys = dotted.split('.');
		let node = root;
		for (let i = 0; i < keys.length - 1; i++) {
			const key = keys[i];
			node[key] =
				typeof node[key] === 'object' && node[key] !== null ? { ...(node[key] as DocData) } : {};
			node = node[key] as DocData;
		}
		const leaf = keys[keys.length - 1];
		if (value === DELETE_SENTINEL) delete node[leaf];
		else node[leaf] = value;
	};

	const applyUpdate = (path: string, patch: DocData) => {
		const cur: DocData = { ...(store.get(path) ?? {}) };
		for (const [k, v] of Object.entries(patch)) {
			if (k.includes('.')) setNested(cur, k, v);
			else if (v === DELETE_SENTINEL) delete cur[k];
			else if (isArrayUnion(v)) {
				const arr = Array.isArray(cur[k]) ? [...(cur[k] as unknown[])] : [];
				for (const item of v.__arrayUnion) arr.push(item);
				cur[k] = arr;
			} else cur[k] = v;
		}
		store.set(path, cur);
	};

	const applySet = (path: string, val: DocData, merge?: boolean) => {
		if (merge) applyUpdate(path, val);
		else store.set(path, { ...val });
	};

	const makeDocRef = (path: string) => ({
		path,
		id: lastSeg(path),
		get: async () => ({
			exists: store.has(path),
			id: lastSeg(path),
			ref: makeDocRef(path),
			data: () => store.get(path)
		}),
		set: async (val: DocData, opts?: { merge?: boolean }) => applySet(path, val, opts?.merge),
		update: async (patch: DocData) => applyUpdate(path, patch),
		delete: async () => {
			store.delete(path);
		}
	});

	const childDocPaths = (collPath: string) =>
		[...store.keys()].filter(
			(k) => k.startsWith(collPath + '/') && !k.slice(collPath.length + 1).includes('/')
		);

	const makeQuery = (collPath: string, order?: string) => ({
		orderBy: (field: string) => makeQuery(collPath, field),
		get: async () => {
			let paths = childDocPaths(collPath);
			if (order) {
				paths = paths.sort(
					(a, b) =>
						((store.get(a)?.[order] as number) ?? 0) - ((store.get(b)?.[order] as number) ?? 0)
				);
			}
			return {
				docs: paths.map((p) => ({ id: lastSeg(p), ref: makeDocRef(p), data: () => store.get(p) }))
			};
		},
		doc: (id: string) => makeDocRef(`${collPath}/${id}`)
	});

	const makeBatch = () => {
		const ops: Array<() => void> = [];
		const batch = {
			set: (ref: { path: string }, val: DocData, opts?: { merge?: boolean }) => {
				ops.push(() => applySet(ref.path, val, opts?.merge));
				return batch;
			},
			update: (ref: { path: string }, patch: DocData) => {
				ops.push(() => applyUpdate(ref.path, patch));
				return batch;
			},
			delete: (ref: { path: string }) => {
				ops.push(() => store.delete(ref.path));
				return batch;
			},
			commit: async () => {
				for (const op of ops) op();
			}
		};
		return batch;
	};

	const firestore = {
		doc: (path: string) => makeDocRef(path),
		collection: (path: string) => makeQuery(path),
		batch: makeBatch,
		runTransaction: async (
			fn: (tx: {
				get: (ref: {
					path: string;
				}) => Promise<{ exists: boolean; data: () => DocData | undefined }>;
				set: (ref: { path: string }, val: DocData, opts?: { merge?: boolean }) => void;
				update: (ref: { path: string }, patch: DocData) => void;
			}) => Promise<unknown>
		) =>
			fn({
				get: async (ref) => ({ exists: store.has(ref.path), data: () => store.get(ref.path) }),
				set: (ref, val, opts) => applySet(ref.path, val, opts?.merge),
				update: (ref, patch) => applyUpdate(ref.path, patch)
			})
	};

	return {
		store,
		firestore,
		FieldValue: {
			delete: () => DELETE_SENTINEL,
			arrayUnion: (...vals: unknown[]): ArrayUnion => ({ __arrayUnion: vals })
		},
		Timestamp: { now: () => 'TS' }
	};
};

export type FirestoreMock = ReturnType<typeof createFirestoreMock>;
