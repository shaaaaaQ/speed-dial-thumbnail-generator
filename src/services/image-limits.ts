import { MAX_IMAGE_PIXELS } from "../domain/model";

type Dimensions = [width: number, height: number];

export function validateDimensions(width: number, height: number) {
    const hasInvalidSize = !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0;
    const exceedsSideLimit = width > 32768 || height > 32768;
    const exceedsPixelLimit = width * height > MAX_IMAGE_PIXELS;

    if (hasInvalidSize || exceedsSideLimit || exceedsPixelLimit) {
        throw new Error("画像が大きすぎるか、寸法が不正です。総画素数を16MP以下に縮小してください。");
    }
}

function readHeaderText(bytes: Uint8Array, offset: number, length: number) {
    return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readWebPDimensions(bytes: Uint8Array, view: DataView): Dimensions {
    const format = readHeaderText(bytes, 12, 4);

    if (format === "VP8X" && bytes.length >= 30) {
        const isAnimated = (bytes[20] & 0x02) !== 0;
        if (isAnimated) {
            throw new Error("アニメーションWebPは使用できません。静止画像に変換してください。");
        }

        // VP8Xは幅・高さから1を引いた値を、それぞれ24ビットで保持する。
        const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
        const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
        return [width, height];
    }

    if (format === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
        // 可逆圧縮形式は幅・高さを14ビットずつ、バイト境界をまたいで保持する。
        const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
        const height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
        return [width, height];
    }

    const hasFrameSignature = bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a;
    if (format === "VP8 " && bytes.length >= 30 && hasFrameSignature) {
        // 非可逆圧縮形式では、16ビットのうち下位14ビットが寸法を表す。
        const width = view.getUint16(26, true) & 0x3fff;
        const height = view.getUint16(28, true) & 0x3fff;
        return [width, height];
    }

    throw new Error("WebPの寸法を読み込めません。");
}

/** デコード用メモリを確保する前に、ファイルのヘッダーから寸法を検査する。 */
export async function rasterDimensions(blob: Blob): Promise<Dimensions> {
    const header = new Uint8Array(await blob.slice(0, 30).arrayBuffer());
    const view = new DataView(header.buffer);
    const isPNG = header.length >= 24
        && readHeaderText(header, 1, 3) === "PNG"
        && readHeaderText(header, 12, 4) === "IHDR";
    const isWebP = readHeaderText(header, 0, 4) === "RIFF"
        && readHeaderText(header, 8, 4) === "WEBP";

    let dimensions: Dimensions;
    if (isPNG) {
        dimensions = [view.getUint32(16), view.getUint32(20)];
    } else if (isWebP) {
        dimensions = readWebPDimensions(header, view);
    } else {
        throw new Error("画像の寸法を読み込めません。");
    }

    validateDimensions(...dimensions);
    return dimensions;
}
