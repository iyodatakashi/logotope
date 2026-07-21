import sharp from 'sharp';

// 白背景の生成画像を正規アセット（256×256 のアルファ透過PNG・RGB=黒）へ確定変換する。
// scripts/avatar-generation/postprocess.py をリファレンス仕様とし、その定数と手順を再現する
// （ずれると全アバターの見た目が変わるため、等価性はゴールデンテストで担保する）。

// これ未満のアルファ（＝薄いドロップシャドウ・背景のにじみ）は透明に落とす。
const SHADOW_CUTOFF = 36;
// 被写体の縦占有（残りは上の余白になる）。下端に接地するので下余白は常に0。
const SUBJECT_HEIGHT_RATIO = 0.92;
const ASSET_SIZE = 256;

export const toAsset = async (raw: Uint8Array): Promise<Uint8Array> => {
	const alpha = await toAlphaPlane(raw);
	const cropped = cropToSubject(alpha);
	const scaled = await scaleToSubjectHeight(cropped);
	const canvas = groundOnCanvas(scaled);

	// RGB は黒のまま色を持たせず、アルファだけを持つ資産にする。
	const rgba = Buffer.alloc(ASSET_SIZE * ASSET_SIZE * 4);
	for (let i = 0; i < canvas.length; i++) rgba[i * 4 + 3] = canvas[i];
	return sharp(rgba, { raw: { width: ASSET_SIZE, height: ASSET_SIZE, channels: 4 } })
		.png({ compressionLevel: 9 })
		.toBuffer();
};

type Plane = { data: Uint8Array; width: number; height: number };

// 輝度→アルファ（黒=不透明・白=透明）に反転し、薄い影/にじみを切り落とす。
// 輝度は PIL の convert('L')（ITU-R 601-2）と同じ係数で求める。
const toAlphaPlane = async (raw: Uint8Array): Promise<Plane> => {
	const { data, info } = await sharp(raw).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const plane = new Uint8Array(info.width * info.height);
	for (let i = 0; i < plane.length; i++) {
		const luminance = Math.round(
			(data[i * 3] * 299 + data[i * 3 + 1] * 587 + data[i * 3 + 2] * 114) / 1000
		);
		const value = 255 - luminance;
		plane[i] = value >= SHADOW_CUTOFF ? value : 0;
	}
	return { data: plane, width: info.width, height: info.height };
};

// 被写体のバウンディングボックス（アルファが 0 でない範囲）へ切り詰める。
const cropToSubject = (plane: Plane): Plane => {
	let left = plane.width;
	let top = plane.height;
	let right = 0;
	let bottom = 0;
	for (let y = 0; y < plane.height; y++) {
		for (let x = 0; x < plane.width; x++) {
			if (plane.data[y * plane.width + x] === 0) continue;
			if (x < left) left = x;
			if (x >= right) right = x + 1;
			if (y < top) top = y;
			if (y >= bottom) bottom = y + 1;
		}
	}
	if (right <= left || bottom <= top) return plane; // 被写体が無ければ切らない（getbbox() が None の場合）

	const width = right - left;
	const height = bottom - top;
	const data = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			data[y * width + x] = plane.data[(top + y) * plane.width + (left + x)];
		}
	}
	return { data, width, height };
};

// 被写体の縦を SUBJECT_HEIGHT_RATIO に合わせる。横は比率を保ち、広ければ 256 を超えてよい。
const scaleToSubjectHeight = async (plane: Plane): Promise<Plane> => {
	const height = Math.round(ASSET_SIZE * SUBJECT_HEIGHT_RATIO);
	const width = Math.max(1, Math.round((plane.width * height) / plane.height));
	const data = await sharp(Buffer.from(plane.data), {
		raw: { width: plane.width, height: plane.height, channels: 1 }
	})
		.resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
		// resize は単チャンネルを sRGB へ広げて返すため、1面のまま取り出す。
		.toColourspace('b-w')
		.raw()
		.toBuffer();
	return { data, width, height };
};

// 下端に接地させ（下余白0・余白は上のみ）、横は中央。広ければ左右にはみ出して切れる。
const groundOnCanvas = (plane: Plane): Uint8Array => {
	const canvas = new Uint8Array(ASSET_SIZE * ASSET_SIZE);
	const offsetX = Math.floor((ASSET_SIZE - plane.width) / 2);
	const offsetY = ASSET_SIZE - plane.height;
	for (let y = 0; y < plane.height; y++) {
		const canvasY = offsetY + y;
		if (canvasY < 0 || canvasY >= ASSET_SIZE) continue;
		for (let x = 0; x < plane.width; x++) {
			const canvasX = offsetX + x;
			if (canvasX < 0 || canvasX >= ASSET_SIZE) continue;
			canvas[canvasY * ASSET_SIZE + canvasX] = plane.data[y * plane.width + x];
		}
	}
	return canvas;
};
