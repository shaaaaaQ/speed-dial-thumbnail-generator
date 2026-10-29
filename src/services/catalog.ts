import { CDN, FALLBACK, MAX_FILE } from "../domain/model";
import { read, write } from "./storage";

export type Catalog = {
    version?: number;
    time: number;
    files: string[];
};

type TreeEntry = {
    path?: string;
    type?: string;
    sha?: string;
};

const CACHE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const TREES_API_URL = "https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/";

function isSVGFilename(value: unknown): value is string {
    return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*\.svg$/.test(value);
}

async function fetchBlob(url: string): Promise<Blob> {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        credentials: "omit",
        referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    if (Number(response.headers.get("Content-Length")) > MAX_FILE) {
        throw new Error("配信されたファイルが大きすぎます。");
    }

    const blob = await response.blob();
    if (blob.size > MAX_FILE) {
        throw new Error("配信されたファイルが大きすぎます。");
    }
    return blob;
}

export async function fetchResource(path: string): Promise<Blob> {
    let lastError: unknown;
    for (const baseURL of [CDN, FALLBACK]) {
        try {
            return await fetchBlob(`${baseURL}/${path}`);
        } catch (error) {
            lastError = error;
        }
    }

    const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
    throw new Error(`配信元に接続できません。通信環境を確認して再試行してください。${detail}`);
}

async function fetchTree(reference: string): Promise<TreeEntry[]> {
    const blob = await fetchBlob(`${TREES_API_URL}${reference}`);
    const data = JSON.parse(await blob.text()) as {
        tree?: TreeEntry[];
        truncated?: boolean;
    };
    if (!Array.isArray(data.tree) || data.truncated !== false) {
        throw new Error("完全なアイコン一覧を取得できませんでした。");
    }
    return data.tree.filter(entry => entry && typeof entry === "object");
}

async function latestFiles(): Promise<string[]> {
    // Contents APIの1000件制限を避け、svgディレクトリのツリーを直接読む。
    const rootEntries = await fetchTree("main");
    const svgDirectory = rootEntries.find(entry => entry.path === "svg" && entry.type === "tree");
    if (!svgDirectory?.sha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(svgDirectory.sha)) {
        throw new Error("SVGディレクトリを取得できませんでした。");
    }

    const svgEntries = await fetchTree(svgDirectory.sha);
    return svgEntries.flatMap(entry => {
        if (entry.type === "blob" && isSVGFilename(entry.path)) {
            return [entry.path];
        }
        return [];
    }).sort();
}

async function legacyFiles(): Promise<string[]> {
    const blob = await fetchResource("tree.json");
    const data = JSON.parse(await blob.text()) as { svg?: unknown };
    if (!Array.isArray(data.svg)) {
        throw new Error("アイコン一覧の形式が変わりました。");
    }

    const files = data.svg.filter(isSVGFilename).sort();
    if (files.length === 0) {
        throw new Error("SVG一覧が空です。");
    }
    return files;
}

async function cacheFiles(files: string[], version: number) {
    try {
        await write("catalog", { version, files, time: Date.now() });
    } catch {
        // キャッシュの保存に失敗しても、取得した一覧は利用できる。
    }
}

export async function catalog(force = false): Promise<{ files: string[]; stale: boolean }> {
    let cached: Catalog | undefined;
    try {
        cached = await read<Catalog>("catalog");
    } catch {
        // 保存領域が使えない場合も、ネットワークからの取得を続ける。
    }

    const hasInvalidCache = cached && (
        !Array.isArray(cached.files) ||
        cached.files.length === 0 ||
        !cached.files.every(isSVGFilename) ||
        !Number.isFinite(cached.time)
    );
    if (hasInvalidCache) {
        cached = undefined;
    }

    // 旧形式のキャッシュは、有効期限内でも新しい一覧の取得を試みる。
    const isFreshCache = cached?.version === 2 && Date.now() - cached.time < CACHE_LIFETIME_MS;
    if (!force && cached && isFreshCache) {
        return { files: cached.files, stale: false };
    }

    try {
        const files = await latestFiles();
        if (files.length === 0) {
            throw new Error("SVG一覧が空です。");
        }
        await cacheFiles(files, 2);
        return { files, stale: false };
    } catch {
        if (cached) {
            return { files: cached.files, stale: true };
        }

        // GitHub APIの障害やレート制限時は、従来の一覧へ切り替える。
        const files = await legacyFiles();
        await cacheFiles(files, 1);
        return { files, stale: true };
    }
}
