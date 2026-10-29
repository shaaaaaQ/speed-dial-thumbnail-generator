import { restore as restoreWorkspace, type Item, type Notify, type Workspace } from "../domain/model";
import { transaction } from "./storage";

const WORKSPACE_KEY = "workspace";
const BLOB_KEY_PREFIX = "blob:";
const SAVE_DELAY_MS = 600;

type SavedItem = Omit<Item, "blob" | "error"> & { hasBlob: boolean };
type Metadata = Omit<Workspace, "version" | "items"> & {
    version: 2;
    items: SavedItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

function collectBlobs(workspace: Workspace) {
    const blobs = new Map<string, Blob>();
    for (const item of workspace.items) {
        if (item.blob) {
            blobs.set(item.id, item.blob);
        }
    }
    return blobs;
}

export function metadata(workspace: Workspace): Metadata {
    return {
        version: 2,
        common: { ...workspace.common },
        selected: workspace.selected,
        items: workspace.items.map(item => ({
            id: item.id,
            name: item.name,
            source: item.source,
            remote: item.remote,
            override: item.override ? { ...item.override } : undefined,
            hasBlob: Boolean(item.blob),
        })),
    };
}

export async function readWorkspace(): Promise<unknown> {
    return transaction<unknown>("readonly", (store, setResult) => {
        const metadataRequest = store.get(WORKSPACE_KEY);
        metadataRequest.onsuccess = () => {
            const saved: unknown = metadataRequest.result;
            const usesSeparateBlobs = isRecord(saved) && saved.version === 2 && Array.isArray(saved.items);
            if (!usesSeparateBlobs) {
                setResult(saved);
                return;
            }

            // 新形式の別レコードからBlobを戻し、既存の復元・検証処理へ渡す。
            const savedItems = saved.items as unknown[];
            const restoredItems = savedItems.map(item => isRecord(item) ? { ...item } : item);
            setResult({ ...saved, version: 1, items: restoredItems });

            // IndexedDBのトランザクションを維持するため、awaitせずイベント内で取得を予約する。
            for (const item of restoredItems) {
                if (!isRecord(item) || typeof item.id !== "string" || !item.hasBlob) {
                    continue;
                }
                const blobRequest = store.get(`${BLOB_KEY_PREFIX}${item.id}`);
                blobRequest.onsuccess = () => {
                    item.blob = blobRequest.result;
                };
            }
        };
    });
}

export async function writeWorkspace(workspace: Workspace, savedBlobs: ReadonlyMap<string, Blob>) {
    const currentBlobs = collectBlobs(workspace);

    await transaction<void>("readwrite", store => {
        store.put(metadata(workspace), WORKSPACE_KEY);

        for (const [itemId, blob] of currentBlobs) {
            const blobKey = `${BLOB_KEY_PREFIX}${itemId}`;
            if (savedBlobs.get(itemId) !== blob) {
                store.put(blob, blobKey);
                continue;
            }

            // 他のタブが削除した画像は、内容が未変更でも再保存する。
            const existsRequest = store.getKey(blobKey);
            existsRequest.onsuccess = () => {
                if (existsRequest.result === undefined) {
                    store.put(blob, blobKey);
                }
            };
        }

        const cursorRequest = store.openKeyCursor();
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
                return;
            }

            const key = cursor.key;
            if (typeof key === "string" && key.startsWith(BLOB_KEY_PREFIX)) {
                const itemId = key.slice(BLOB_KEY_PREFIX.length);
                if (!currentBlobs.has(itemId)) {
                    store.delete(key);
                }
            }
            cursor.continue();
        };
    });

    return currentBlobs;
}

export function createPersistence(notify: Notify) {
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saveQueue = Promise.resolve();
    let savedBlobs = new Map<string, Blob>();
    let pendingSnapshot: Workspace | undefined;

    async function restore() {
        try {
            const saved = await readWorkspace();
            const workspace = restoreWorkspace(saved);
            if (workspace) {
                savedBlobs = collectBlobs(workspace);
            } else if (saved) {
                notify("保存データの形式を読み込めませんでした。初期設定で起動しました。", true);
            }
            return workspace;
        } catch {
            notify("保存領域を利用できません。生成・ダウンロードは利用できますが、再読み込みすると内容が失われます。", true);
        }
    }

    function flush(snapshot: Workspace) {
        clearTimeout(saveTimer);

        // 保存待ちの変更は最新のスナップショットへまとめ、書き込みを直列に実行する。
        pendingSnapshot = snapshot;
        saveQueue = saveQueue.then(async () => {
            if (!pendingSnapshot) {
                return;
            }
            const snapshotToSave = pendingSnapshot;
            pendingSnapshot = undefined;

            try {
                savedBlobs = await writeWorkspace(snapshotToSave, savedBlobs);
            } catch {
                notify("ブラウザに保存できませんでした。容量・プライベートモード・サイトの保存権限を確認してください。現在の画像は書き出せます。", true);
            }
        });
        return saveQueue;
    }

    function schedule(snapshot: Workspace) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => flush(snapshot), SAVE_DELAY_MS);
        return () => clearTimeout(saveTimer);
    }

    function dispose() {
        clearTimeout(saveTimer);
    }

    return { restore, schedule, flush, dispose };
}
