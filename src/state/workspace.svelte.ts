import {
    defaults,
    getMessage,
    MAX_DECODED_PIXELS,
    MAX_ITEMS,
    MAX_TOTAL,
    type Item,
    type Notify,
    type Workspace,
} from "../domain/model";
import { fetchResource } from "../services/catalog";
import { decode, prepare } from "../services/images";
import { createLimiter } from "../utils/tasks";

const browserImageServices = { prepare, decode, fetchResource };

type CapacityCheck = {
    blob?: Blob;
    image?: HTMLImageElement;
    replacingItemId?: string;
};

export class Studio {
    workspace = $state<Workspace>({
        version: 1,
        common: { ...defaults },
        items: [],
    });
    images = $state<Record<string, HTMLImageElement>>({});
    loading = $state<Record<string, boolean>>({});
    ready = $state(false);

    private disposed = false;
    private runImageTask = createLimiter(3);

    constructor(
        private notify: Notify,
        private imageServices = browserImageServices,
    ) {}

    get current() {
        return this.workspace.items.find(item => item.id === this.workspace.selected);
    }

    get hasExportable() {
        return this.workspace.items.some(item => Boolean(this.images[item.id]));
    }

    remove(item: Item) {
        const index = this.workspace.items.findIndex(candidate => candidate.id === item.id);
        if (index < 0) {
            return;
        }

        this.workspace.items.splice(index, 1);
        delete this.images[item.id];

        if (this.workspace.selected === item.id) {
            const nextIndex = Math.min(index, this.workspace.items.length - 1);
            this.workspace.selected = this.workspace.items[nextIndex]?.id;
        }
    }

    private checkCapacity({ blob, image, replacingItemId }: CapacityCheck = {}) {
        const isAddingItem = replacingItemId === undefined;
        if (isAddingItem && this.workspace.items.length >= MAX_ITEMS) {
            throw new Error("追加できる画像は100件までです。不要なアイコンを削除してください。");
        }

        // 置き換え時は、更新前の画像を合計から除いて計算する。
        const otherItems = this.workspace.items.filter(item => item.id !== replacingItemId);
        const storedBytes = otherItems.reduce((total, item) => {
            return total + (item.blob?.size ?? 0);
        }, 0);
        if (blob && storedBytes + blob.size > MAX_TOTAL) {
            throw new Error("画像の合計容量が50MBを超えます。不要な画像を削除してください。");
        }

        const decodedPixels = otherItems.reduce((total, item) => {
            const decodedImage = this.images[item.id];
            if (!decodedImage) {
                return total;
            }
            return total + decodedImage.naturalWidth * decodedImage.naturalHeight;
        }, 0);
        const additionalPixels = image ? image.naturalWidth * image.naturalHeight : 0;
        if (image && decodedPixels + additionalPixels > MAX_DECODED_PIXELS) {
            throw new Error("読み込み画像の総画素数が上限を超えます。画像を縮小するか、不要な画像を削除してください。");
        }
    }

    async loadItem(item: Item, retry = false) {
        if (this.loading[item.id] || this.disposed) {
            return;
        }

        this.loading[item.id] = true;
        item.error = undefined;

        try {
            await this.runImageTask(async () => {
                const stillExists = this.workspace.items.some(candidate => candidate.id === item.id);
                if (this.disposed || !stillExists) {
                    return;
                }

                let blob = item.blob;
                if ((!blob || retry) && item.remote) {
                    blob = await this.imageServices.fetchResource(`svg/${item.remote}`);
                }
                if (!blob) {
                    throw new Error("画像データが保存されていません。ファイルを追加し直してください。");
                }

                const preparedBlob = await this.imageServices.prepare(blob, item.remote ?? item.name);
                const image = await this.imageServices.decode(preparedBlob);
                const currentItem = this.workspace.items.find(candidate => candidate.id === item.id);
                if (!currentItem || this.disposed) {
                    return;
                }

                // 並行追加で上限を超えないよう、容量確認から登録まで await を挟まない。
                this.checkCapacity({ blob: preparedBlob, image, replacingItemId: item.id });
                currentItem.blob = preparedBlob;
                this.images[item.id] = image;
            });
        } catch (error) {
            const currentItem = this.workspace.items.find(candidate => candidate.id === item.id);
            if (currentItem && !this.disposed) {
                currentItem.error = getMessage(error);
                delete this.images[item.id];
            }
        } finally {
            delete this.loading[item.id];
        }
    }

    async restoreImages() {
        // 保存済み画像を先にキューへ入れ、通信待ちで復元が遅れるのを避ける。
        const storedItems = this.workspace.items.filter(item => item.blob);
        const missingItems = this.workspace.items.filter(item => !item.blob);
        const restoreOrder = [...storedItems, ...missingItems];
        await Promise.all(restoreOrder.map(item => this.loadItem(item)));
    }

    private async addLocalFile(file: File) {
        if (this.disposed) {
            return false;
        }

        this.checkCapacity({ blob: file });
        const blob = await this.imageServices.prepare(file, file.name);
        const image = await this.imageServices.decode(blob);
        if (this.disposed) {
            return false;
        }

        this.checkCapacity({ blob, image });
        const item: Item = {
            id: crypto.randomUUID(),
            name: file.name,
            source: "local",
            blob,
        };
        this.workspace.items.push(item);
        this.images[item.id] = image;
        this.workspace.selected = item.id;
        return true;
    }

    async addLocal(input: FileList | File[]) {
        if (!this.ready || this.disposed) {
            return;
        }

        let addedCount = 0;
        const problems: string[] = [];
        for (const file of Array.from(input)) {
            try {
                const added = await this.runImageTask(() => this.addLocalFile(file));
                if (added) {
                    addedCount++;
                }
            } catch (error) {
                problems.push(`${file.name}: ${getMessage(error)}`);
            }
        }

        if (this.disposed) {
            return;
        }
        const hasProblems = problems.length > 0;
        const message = hasProblems
            ? `${addedCount}件追加。${problems.join(" / ")}`
            : `${addedCount}件の画像を追加しました。`;
        this.notify(message, hasProblems);
    }

    async toggleRemote(file: string): Promise<string> {
        if (!this.ready || this.disposed) {
            return "";
        }

        const existingItem = this.workspace.items.find(item => item.remote === file);
        if (existingItem) {
            this.remove(existingItem);
            return `${existingItem.name}の選択を解除しました`;
        }

        try {
            this.checkCapacity();
        } catch (error) {
            return getMessage(error);
        }

        const item: Item = {
            id: crypto.randomUUID(),
            name: file.slice(0, -4),
            remote: file,
            source: "dashboard",
        };
        this.workspace.items.push(item);
        this.workspace.selected = item.id;

        // Svelte が配列に格納したリアクティブなオブジェクトを読み込み処理へ渡す。
        const currentItem = this.workspace.items.find(candidate => candidate.id === item.id)!;
        await this.loadItem(currentItem);
        if (!this.workspace.items.some(candidate => candidate.id === item.id)) {
            return "";
        }
        if (currentItem.error) {
            return `${item.name}: ${currentItem.error}`;
        }
        return `${item.name}を追加しました`;
    }

    dispose() {
        this.disposed = true;
    }
}
