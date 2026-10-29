export type Settings = {
    background: string;
    logoSize: number;
    width: number;
    height: number;
};

export type Item = {
    id: string;
    name: string;
    source: "dashboard" | "local";
    remote?: string;
    blob?: Blob;
    override?: Settings;
    error?: string;
};

export type Workspace = {
    version: 1;
    common: Settings;
    items: Item[];
    selected?: string;
};

export type Notify = (message: string, error?: boolean) => void;

export const defaults: Settings = {
    background: "#FFFFFF",
    logoSize: 165,
    width: 440,
    height: 360,
};

export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MAX_DECODED_PIXELS = 32 * 1024 * 1024;
export const MAX_ITEMS = 100;
export const MAX_FILE = 10 * 1024 * 1024;
export const MAX_TOTAL = 50 * 1024 * 1024;
export const CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons";
export const FALLBACK = "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main";

export function getMessage(error: unknown) {
    return error instanceof Error ? error.message : "処理に失敗しました。";
}

export function settingsFor(item: Item, common: Settings) {
    return item.override ?? common;
}

export function validSettings(value: unknown): value is Settings {
    if (!value || typeof value !== "object") {
        return false;
    }
    const settings = value as Settings;
    return (
        typeof settings.background === "string" &&
        /^#[0-9a-f]{6}$/i.test(settings.background) &&
        Number.isInteger(settings.width) &&
        settings.width >= 64 &&
        settings.width <= 4096 &&
        Number.isInteger(settings.height) &&
        settings.height >= 64 &&
        settings.height <= 4096 &&
        Number.isInteger(settings.logoSize) &&
        settings.logoSize >= 16 &&
        settings.logoSize <= 4096
    );
}

export function restore(value: unknown): Workspace | undefined {
    const savedWorkspace = value as Workspace | undefined;
    if (
        !savedWorkspace ||
        savedWorkspace.version !== 1 ||
        !validSettings(savedWorkspace.common) ||
        !Array.isArray(savedWorkspace.items)
    ) {
        return;
    }

    const seenIds = new Set<string>();
    const items = savedWorkspace.items
        .slice(0, MAX_ITEMS)
        .filter(item => {
            if (
                !item ||
                typeof item.id !== "string" ||
                seenIds.has(item.id) ||
                typeof item.name !== "string" ||
                !["dashboard", "local"].includes(item.source)
            ) {
                return false;
            }
            seenIds.add(item.id);
            return true;
        })
        .map(item => ({
            id: item.id,
            name: item.name,
            source: item.source,
            remote: typeof item.remote === "string" && /^[a-z0-9][a-z0-9._-]*\.svg$/.test(item.remote)
                ? item.remote
                : undefined,
            override: validSettings(item.override) ? item.override : undefined,
            blob: item.blob instanceof Blob ? item.blob : undefined,
        }));

    const selectedItemExists = items.some(item => item.id === savedWorkspace.selected);
    return {
        version: 1,
        common: savedWorkspace.common,
        items,
        selected: selectedItemExists ? savedWorkspace.selected : items[0]?.id,
    };
}
