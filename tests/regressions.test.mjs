import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

await test("regressions", async t => {
    const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
    t.after(() => server.close());
    const { Studio } = await server.ssrLoadModule("/src/state/workspace.svelte.ts");
    const model = await server.ssrLoadModule("/src/domain/model.ts");
    const { filename, setSVGDimensions } = await server.ssrLoadModule("/src/services/images.ts");
    const { rasterDimensions, validateDimensions } = await server.ssrLoadModule("/src/services/image-limits.ts");
    const { exportImages, MAX_ZIP_PNG_BYTES } = await server.ssrLoadModule("/src/services/export.ts");
    const { metadata } = await server.ssrLoadModule("/src/services/persistence.ts");
    const { createLimiter } = await server.ssrLoadModule("/src/utils/tasks.ts");
    const { thumbnail } = await server.ssrLoadModule("/src/actions/thumbnail.ts");
    const MiB = 1024 * 1024;
    const image = (w = 32, h = 32) => ({ naturalWidth: w, naturalHeight: h });
    const fakeBlob = size => ({ size });
    const makeStudio = (overrides = {}) => new Studio(() => { }, {
        prepare: async blob => blob, decode: async () => image(),
        fetchResource: async () => fakeBlob(8 * MiB), ...overrides,
    });
    const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

    await t.test("parallel remote commits cannot exceed 50 MiB", async () => {
        const studio = makeStudio();
        studio.ready = true;
        studio.workspace.items = [{ id: "base", blob: fakeBlob(40 * MiB) }, { id: "a", remote: "a.svg" }, { id: "b", remote: "b.svg" }];
        await Promise.all(studio.workspace.items.slice(1).map(i => studio.loadItem(i)));
        assert.equal(studio.workspace.items.reduce((n, i) => n + (i.blob?.size ?? 0), 0), 48 * MiB);
        assert.equal(studio.workspace.items.filter(i => i.error).length, 1);
    });

    await t.test("parallel local additions respect the item limit", async () => {
        const studio = makeStudio(); studio.ready = true;
        studio.workspace.items = Array.from({ length: 99 }, (_, i) => ({ id: String(i) }));
        await Promise.all([studio.addLocal([{ name: "a.png", size: 1 }]), studio.addLocal([{ name: "b.png", size: 1 }])]);
        assert.equal(studio.workspace.items.length, 100);
    });

    await t.test("deleted items cannot be resurrected by a pending load", async () => {
        const gate = deferred();
        const studio = makeStudio({ decode: () => gate.promise });
        const item = { id: "gone", remote: "a.svg" }; studio.workspace.items = [item];
        const loading = studio.loadItem(item); studio.remove(item); gate.resolve(image()); await loading;
        assert.deepEqual(studio.images, {}); assert.equal(studio.workspace.items.length, 0);
    });

    await t.test("restoration starts saved local images before missing remote sources", async () => {
        const remote = deferred(); let decodedLocal = false;
        const studio = makeStudio({ fetchResource: () => remote.promise, decode: async () => { decodedLocal = true; return image(); } });
        studio.workspace.items = [{ id: "remote", remote: "a.svg" }, { id: "local", blob: fakeBlob(1) }];
        const restoring = studio.restoreImages();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        assert.equal(decodedLocal, true); assert.ok(studio.images.local);
        remote.resolve(fakeBlob(1)); await restoring;
    });

    await t.test("decoded image memory has a workspace-wide pixel budget", async () => {
        const studio = makeStudio({ decode: async () => image(4096, 4096) });
        studio.workspace.items = [{ id: "a", blob: fakeBlob(1) }, { id: "b", blob: fakeBlob(1) }, { id: "c", blob: fakeBlob(1) }];
        await studio.restoreImages();
        assert.equal(Object.keys(studio.images).length, 2);
        assert.match(studio.workspace.items[2].error, /総画素数/);
    });

    await t.test("encoded PNG dimensions reject compressed oversized images", async () => {
        const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
        const view = new DataView(bytes.buffer); view.setUint32(16, 16384); view.setUint32(20, 16384);
        await assert.rejects(rasterDimensions(new Blob([bytes])), /16MP/);
        view.setUint32(16, 440); view.setUint32(20, 360);
        assert.deepEqual(await rasterDimensions(new Blob([bytes])), [440, 360]);
    });

    await t.test("static WebP dimensions support all three encodings", async () => {
        for (const kind of ["VP8X", "VP8L", "VP8 "]) {
            const bytes = new Uint8Array(30);
            bytes.set(new TextEncoder().encode("RIFF")); bytes.set(new TextEncoder().encode("WEBP"), 8);
            bytes.set(new TextEncoder().encode(kind), 12);
            if (kind === "VP8X") { bytes[24] = 99; bytes[27] = 49; }
            if (kind === "VP8L") { bytes[20] = 47; bytes[21] = 99; bytes[22] = (49 & 3) << 6; bytes[23] = 49 >> 2; }
            if (kind === "VP8 ") { bytes.set([157, 1, 42], 23); bytes[26] = 100; bytes[28] = 50; }
            assert.deepEqual(await rasterDimensions(new Blob([bytes])), [100, 50]);
        }
    });

    await t.test("invalid and animated image dimensions are rejected", async () => {
        for (const [w, h] of [[0, 10], [Infinity, 1], [32768, 32768]]) assert.throws(() => validateDimensions(w, h));
        const bytes = new Uint8Array(30); bytes.set(new TextEncoder().encode("RIFF")); bytes.set(new TextEncoder().encode("WEBPVP8X"), 8); bytes[20] = 2;
        await assert.rejects(rasterDimensions(new Blob([bytes])), /アニメーション/);
    });

    await t.test("filenames preserve dots in catalog names and remove only local image extensions", () => {
        assert.equal(filename("foo.bar"), "foo.bar");
        assert.equal(filename("foo.bar.svg", true), "foo.bar");
        assert.equal(filename("foo.bar", true), "foo.bar");
        assert.equal(filename("/"), "-");
    });

    await t.test("SVG dimensions preserve explicit sizes and infer only missing dimensions", () => {
        const cases = [
            [{ width: "200", height: "100", viewBox: "0 0 100 100" }, "200", "100"],
            [{ width: "100", height: "100", viewBox: "0 0 10000 10000" }, "100", "100"],
            [{ width: "2in", viewBox: "0 0 200 100" }, "2in", "96"],
            [{ height: "50", viewBox: "0 0 200 100" }, "100", "50"],
            [{ viewBox: "0 0 200 100" }, "200", "100"],
            [{}, "300", "150"],
        ];
        for (const [attributes, width, height] of cases) {
            const root = {
                getAttribute: key => attributes[key] ?? null,
                setAttribute: (key, value) => { attributes[key] = value; },
            };
            setSVGDimensions(root);
            assert.equal(attributes.width, width);
            assert.equal(attributes.height, height);
        }
        for (const width of ["0", "100%", "40000"]) {
            const attributes = { width, height: "100", viewBox: "0 0 100 100" };
            assert.throws(() => setSVGDimensions({
                getAttribute: key => attributes[key] ?? null,
                setAttribute: (key, value) => { attributes[key] = value; },
            }));
        }
    });

    await t.test("restore filters duplicates and invalid overrides without retaining transient fields", () => {
        const saved = {
            version: 1, common: model.defaults, selected: "bad", items: [
                { id: "a", name: "a", source: "local", blob: new Blob(["x"]), error: "old", override: { width: -1 } },
                { id: "a", name: "duplicate", source: "local" },
                { id: "bad", name: 123, source: "local" },
            ]
        };
        const restored = model.restore(saved);
        assert.equal(restored.items.length, 1); assert.equal(restored.selected, "a");
        assert.equal(restored.items[0].override, undefined); assert.equal(restored.items[0].error, undefined);
        assert.equal(restored.items[0].blob.size, 1);
        assert.equal(model.restore({ ...saved, common: { ...model.defaults, width: 0 } }), undefined);
    });

    await t.test("metadata contains no blobs or transient errors", () => {
        const data = metadata({ version: 1, common: model.defaults, items: [{ id: "a", name: "a", source: "local", blob: new Blob(["x"]), error: "transient" }] });
        assert.equal(data.version, 2); assert.equal(data.items[0].hasBlob, true);
        assert.equal("blob" in data.items[0], false); assert.equal("error" in data.items[0], false);
    });

    await t.test("export preserves dotted names, deduplicates case-insensitively, and reports partial failure", async () => {
        let zipEntries; const downloads = [];
        const targets = ["foo.bar", "FOO.BAR", "broken", "not-loaded"].map((name, n) => ({ item: { name, source: "dashboard" }, settings: model.defaults, img: n === 3 ? undefined : { name } }));
        const canvas = { width: 1, height: 1 };
        const result = await exportImages(targets, true, () => { }, {
            canvas: () => canvas, draw: (_, img) => { if (img.name === "broken") throw Error("bad"); },
            png: async () => new Blob(["png"]), download: (_, name) => downloads.push(name),
            zip: entries => { zipEntries = entries; return new Uint8Array(); }, yield: async () => { },
        });
        assert.deepEqual(Object.keys(zipEntries), ["foo.bar.png", "FOO.BAR-2.png"]);
        assert.deepEqual(result.failed, ["broken", "not-loaded"]); assert.equal(result.count, 2);
        assert.deepEqual(downloads, ["speed-dial-thumbnails.zip"]); assert.equal(canvas.width, 0);
    });

    await t.test("all-failed export does not download an empty archive", async () => {
        let downloaded = false;
        const result = await exportImages([{ item: { name: "missing" }, settings: model.defaults }], true, () => { }, {
            canvas: () => ({}), draw() { }, png: async () => new Blob(), download() { downloaded = true; }, zip: () => new Uint8Array(), yield: async () => { },
        });
        assert.equal(result.count, 0); assert.equal(downloaded, false);
    });

    await t.test("ZIP capacity stops export before buffering the excess PNG or downloading a partial archive", async () => {
        for (const sizes of [[MAX_ZIP_PNG_BYTES + 1], [MAX_ZIP_PNG_BYTES / 2, MAX_ZIP_PNG_BYTES / 2, 1, 1]]) {
            let generated = 0, buffered = 0;
            const canvas = { width: 1, height: 1 };
            const targets = sizes.map((_, index) => ({ item: { name: String(index), source: "local" }, settings: model.defaults, img: image() }));
            await assert.rejects(exportImages(targets, true, () => {}, {
                canvas: () => canvas, draw() {},
                png: async () => ({
                    size: sizes[generated++],
                    arrayBuffer: async () => { buffered++; return new ArrayBuffer(1); },
                }),
                zip: () => assert.fail("must not build a partial ZIP"),
                download: () => assert.fail("must not download a partial ZIP"),
                yield: async () => {},
            }), /100MB.*件数か出力サイズ/);
            assert.equal(generated, sizes.length === 1 ? 1 : 3);
            assert.equal(buffered, generated - 1);
            assert.equal(canvas.width, 0);
            assert.equal(canvas.height, 0);
        }
    });

    await t.test("ZIP allows exactly the capacity limit and standalone PNG is unaffected", async () => {
        for (const exportAll of [true, false]) {
            const downloads = [];
            const result = await exportImages([{ item: { name: "a", source: "local" }, settings: model.defaults, img: image() }], exportAll, () => {}, {
                canvas: () => ({}), draw() {},
                png: async () => ({ size: MAX_ZIP_PNG_BYTES + (exportAll ? 0 : 1), arrayBuffer: async () => new ArrayBuffer(1) }),
                zip: () => new Uint8Array(1),
                download: (_, name) => downloads.push(name), yield: async () => {},
            });
            assert.equal(result.count, 1);
            assert.deepEqual(downloads, [exportAll ? "speed-dial-thumbnails.zip" : "a.png"]);
        }
    });

    await t.test("limiter bounds concurrency and continues after a rejected task", async () => {
        const run = createLimiter(2); let active = 0, peak = 0;
        const results = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => run(async () => {
            active++; peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 1)); active--;
            if (n === 0) throw Error("expected"); return n;
        })));
        assert.equal(peak, 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 7);
    });

    await t.test("preview falls back to Raw and releases observers and event listeners", () => {
        const previous = globalThis.IntersectionObserver;
        let intersect, disconnected = 0;
        globalThis.IntersectionObserver = class {
            constructor(callback) { intersect = callback; }
            observe() { }
            disconnect() { disconnected++; }
        };
        try {
            const img = new EventTarget();
            img.closest = () => null; img.style = {}; img.parentElement = { dataset: {} };
            img.removeAttribute = () => { delete img.src; };
            const action = thumbnail(img, "foo.svg");
            assert.equal(img.src, undefined);
            intersect([{ isIntersecting: true }]);
            assert.equal(img.src, `${model.CDN}/svg/foo.svg`);
            img.dispatchEvent(new Event("error"));
            assert.equal(img.src, `${model.FALLBACK}/svg/foo.svg`);
            img.dispatchEvent(new Event("error"));
            assert.equal(img.parentElement.dataset.unavailable, "プレビューなし");
            action.destroy(); img.dispatchEvent(new Event("error"));
            assert.equal(img.src, undefined); assert.ok(disconnected >= 2);
        } finally { globalThis.IntersectionObserver = previous; }
    });
});
