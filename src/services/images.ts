import DOMPurify from "dompurify";
import { MAX_FILE, type Settings } from "../domain/model";
import { rasterDimensions, validateDimensions } from "./image-limits";

function validateCSSReferences(css: string) {
    // CSSエスケープやコメント経由の外部参照も避けるため、使用可能な構文を絞る。
    if (/[@\\]|\/\*/.test(css)) {
        throw new Error("外部参照・特殊なCSSを含むSVGは使用できません。");
    }
    for (const match of css.matchAll(/url\s*\(([^)]*)\)/gi)) {
        const reference = match[1];
        if (!/^\s*['"]?#[\w:.-]+['"]?\s*$/.test(reference)) {
            throw new Error("外部リソースを参照するSVGは使用できません。");
        }
    }
}

function validateSVGReferences(root: Element) {
    for (const element of [root, ...root.querySelectorAll("*")]) {
        if (element.localName === "style") {
            validateCSSReferences(element.textContent ?? "");
        }
        for (const attribute of [...element.attributes]) {
            if (/^on/i.test(attribute.name)) {
                element.removeAttributeNode(attribute);
            }
            if (attribute.localName === "href" && !/^#[\w:.-]+$/.test(attribute.value)) {
                throw new Error("外部リンクを含むSVGは使用できません。");
            }
            validateCSSReferences(attribute.value);
        }
    }
}

function parseSVGLength(value: string | null, fallback: number) {
    if (!value) {
        return fallback;
    }
    const match = /^([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(px|pt|pc|mm|cm|in)?$/i.exec(value.trim());
    if (!match) {
        throw new Error("SVGの幅・高さは数値または絶対単位で指定してください。");
    }

    const pixelsPerUnit: Record<string, number> = {
        px: 1,
        pt: 96 / 72,
        pc: 16,
        mm: 96 / 25.4,
        cm: 96 / 2.54,
        in: 96,
    };
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase() ?? "px";
    return amount * pixelsPerUnit[unit];
}

export function setSVGDimensions(root: Element) {
    const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    const hasUsableViewBox = viewBox?.length === 4
        && viewBox.every(Number.isFinite)
        && viewBox[2] > 0
        && viewBox[3] > 0;

    const widthAttribute = root.getAttribute("width");
    const heightAttribute = root.getAttribute("height");
    const specifiedWidth = widthAttribute ? parseSVGLength(widthAttribute, 300) : undefined;
    const specifiedHeight = heightAttribute ? parseSVGLength(heightAttribute, 150) : undefined;

    // 明示寸法を優先し、欠けている寸法だけをviewBoxの縦横比から補う。
    const width = specifiedWidth ?? (hasUsableViewBox
        ? (specifiedHeight === undefined ? viewBox[2] : specifiedHeight * viewBox[2] / viewBox[3])
        : 300);
    const height = specifiedHeight ?? (hasUsableViewBox
        ? width * viewBox[3] / viewBox[2]
        : 150);
    validateDimensions(width, height);
    if (!widthAttribute) {
        root.setAttribute("width", String(width));
    }
    if (!heightAttribute) {
        root.setAttribute("height", String(height));
    }
}

export function sanitizeSVG(text: string): Blob {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
        throw new Error("DOCTYPE・実体参照を含むSVGは使用できません。");
    }
    const document = new DOMParser().parseFromString(text, "image/svg+xml");
    if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
        throw new Error("有効なSVGではありません。");
    }

    const sanitizedText = DOMPurify.sanitize(text, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: [
            "script",
            "foreignObject",
            "image",
            "feImage",
            "animate",
            "animateMotion",
            "animateTransform",
            "set",
            "a",
        ],
        FORBID_ATTR: ["xml:base"],
    });
    const sanitizedDocument = new DOMParser().parseFromString(sanitizedText, "image/svg+xml");
    const root = sanitizedDocument.documentElement;
    if (root.localName !== "svg") {
        throw new Error("SVGを安全に読み込めませんでした。");
    }

    validateSVGReferences(root);
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    setSVGDimensions(root);

    const serializedSVG = new XMLSerializer().serializeToString(root);
    return new Blob([serializedSVG], { type: "image/svg+xml" });
}

export async function prepare(blob: Blob, name = ""): Promise<Blob> {
    if (blob.size > MAX_FILE) {
        throw new Error("画像は1ファイル10MB以内にしてください。");
    }
    const isSVG = blob.type === "image/svg+xml" || /\.svg$/i.test(name);
    if (isSVG) {
        const originalText = await blob.text();
        const sanitizedBlob = sanitizeSVG(originalText);
        const isUnchanged = blob.type === sanitizedBlob.type && originalText === await sanitizedBlob.text();
        return isUnchanged ? blob : sanitizedBlob;
    }

    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const isPNG = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71;
    const isWebP = String.fromCharCode(...header.slice(0, 4)) === "RIFF"
        && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
    if (!isPNG && !isWebP) {
        throw new Error("SVG・PNG・WebP形式の画像を選んでください。");
    }

    const mimeType = isPNG ? "image/png" : "image/webp";
    const preparedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
    await rasterDimensions(preparedBlob);
    return preparedBlob;
}

export async function decode(blob: Blob): Promise<HTMLImageElement> {
    // SVGはprepareで検査済み。ラスター画像はデコード前にもヘッダーを検査する。
    if (blob.type !== "image/svg+xml") {
        await rasterDimensions(blob);
    }
    return new Promise((resolve, reject) => {
        const objectURL = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(objectURL);
            try {
                validateDimensions(image.naturalWidth, image.naturalHeight);
                resolve(image);
            } catch (error) {
                reject(error);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectURL);
            reject(new Error("画像を読み込めません。SVGの寸法や形式を確認してください。"));
        };
        image.src = objectURL;
    });
}

export function draw(
    canvas: HTMLCanvasElement,
    image: HTMLImageElement | undefined,
    settings: Settings,
) {
    canvas.width = settings.width;
    canvas.height = settings.height;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvasを利用できません。");
    }
    context.fillStyle = settings.background;
    context.fillRect(0, 0, settings.width, settings.height);
    if (!image) {
        return;
    }

    const scale = Math.min(
        settings.logoSize / Math.max(image.naturalWidth, image.naturalHeight),
        settings.width / image.naturalWidth,
        settings.height / image.naturalHeight,
    );
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
        image,
        (settings.width - width) / 2,
        (settings.height - height) / 2,
        width,
        height,
    );
}

export function png(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error("PNGの生成に失敗しました。"));
            }
        }, "image/png");
    });
}

export function download(blob: Blob, name: string) {
    const objectURL = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectURL;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectURL), 30000);
}

export function filename(name: string, stripExtension = false) {
    const baseName = stripExtension ? name.replace(/\.(?:svg|png|webp)$/i, "") : name;
    const safeName = baseName.replace(/[^\p{L}\p{N}_.-]/gu, "-").slice(0, 90);
    return safeName || "thumbnail";
}
