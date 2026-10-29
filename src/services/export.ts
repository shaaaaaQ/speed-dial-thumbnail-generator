import { zipSync } from "fflate";
import { download, draw, filename, png } from "./images";
import type { Item, Settings } from "../domain/model";

export const MAX_ZIP_PNG_BYTES = 100 * 1024 * 1024;

class ExportSizeLimitError extends Error {
    constructor() {
        super("ZIPにまとめるPNGの合計容量が100MBを超えました。画像の件数か出力サイズを減らして、もう一度保存してください。");
    }
}

export type ExportTarget = {
    item: Item;
    settings: Settings;
    img?: HTMLImageElement;
};

// ブラウザAPIをまとめ、テストではCanvasやダウンロードを差し替えられるようにする。
const browserExportServices = {
    canvas: () => document.createElement("canvas"),
    draw,
    png,
    download,
    zip: (entries: Record<string, Uint8Array>) => zipSync(entries, { level: 0 }),
    yield: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
};

function uniqueFilename(item: Item, usedFilenames: Set<string>) {
    const baseName = filename(item.name, item.source === "local");
    let candidate = `${baseName}.png`;
    let suffix = 2;

    while (usedFilenames.has(candidate.toLowerCase())) {
        candidate = `${baseName}-${suffix}.png`;
        suffix++;
    }
    return candidate;
}

export async function exportImages(
    targets: ExportTarget[],
    exportAll: boolean,
    onProgress: (value: string) => void,
    services = browserExportServices,
) {
    const failed: string[] = [];
    const usedFilenames = new Set<string>();
    const entries: Record<string, Uint8Array> = Object.create(null);
    const canvas = services.canvas();
    let totalBytes = 0;

    try {
        for (const [index, target] of targets.entries()) {
            const { item, settings, img: image } = target;
            onProgress(`生成中 ${index + 1} / ${targets.length}`);
            if (!image) {
                failed.push(item.name);
                continue;
            }

            try {
                services.draw(canvas, image, settings);
                const blob = await services.png(canvas);
                const outputName = uniqueFilename(item, usedFilenames);

                if (exportAll) {
                    // バッファ化やZIP生成でメモリが増える前に、PNGの累積容量を制限する。
                    if (totalBytes + blob.size > MAX_ZIP_PNG_BYTES) {
                        throw new ExportSizeLimitError();
                    }
                    entries[outputName] = new Uint8Array(await blob.arrayBuffer());
                    totalBytes += blob.size;
                } else {
                    services.download(blob, outputName);
                }
                usedFilenames.add(outputName.toLowerCase());
            } catch (error) {
                if (error instanceof ExportSizeLimitError) {
                    throw error;
                }
                failed.push(item.name);
            }

            // 画像ごとに制御を返し、進捗表示を更新する。
            await services.yield();
        }

        if (exportAll && Object.keys(entries).length > 0) {
            onProgress("ZIPを作成中…");
            await services.yield();
            const archive = services.zip(entries);
            const archiveBlob = new Blob([archive as Uint8Array<ArrayBuffer>], {
                type: "application/zip",
            });
            services.download(archiveBlob, "speed-dial-thumbnails.zip");
        }

        const count = usedFilenames.size;
        const message = failed.length > 0
            ? `${count}件を書き出しました。${failed.length}件は生成できませんでした（${failed.join(", ")}）。`
            : `${count}件の${exportAll ? "画像をZIPで" : "PNGを"}書き出しました。`;
        return { failed, count, message };
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}
