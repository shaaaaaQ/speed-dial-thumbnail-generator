import {
    readFile,
    readdir,
    mkdir,
    writeFile,
    realpath,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
// Include direct runtime dependencies and their dependencies. Svelte also ships
// a compiler, whose parser/source-map packages are not sent to the browser.
const project = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const included = new Set();
async function resolvePackage(name, from = root) {
    const require = createRequire(join(from, "package.json"));
    for (const directory of require.resolve.paths(name) ?? []) {
        try {
            return await realpath(join(directory, name));
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
    throw new Error(`Installed package not found: ${name} (from ${from})`);
}
async function includePackage(name, from = root) {
    const path = await resolvePackage(name, from);
    if (included.has(path)) return;
    included.add(path);
    const pkg = JSON.parse(
        await readFile(join(path, "package.json"), "utf8"),
    );
    const dependencies =
        name === "svelte"
            ? ["esm-env", "clsx", "devalue"]
            : Object.keys(pkg.dependencies ?? {});
    for (const dependency of dependencies) await includePackage(dependency, path);
}
for (const name of Object.keys(project.dependencies))
    await includePackage(name);
// Vite injects its modulepreload runtime helper into the output.
included.add(await resolvePackage("vite"));
const packages = [...included];
const notices = new Map();
function addNotice(label, text) {
    text = text.trim();
    const key = text.replace(/\s+/g, " ");
    if (!notices.has(key)) notices.set(key, { text, labels: new Set() });
    notices.get(key).labels.add(label);
}
addNotice(`${project.name} - MIT-0`, await readFile(join(root, "LICENSE"), "utf8"));
async function collectSourceNotices(directory, label) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await collectSourceNotices(path, label);
        else if (entry.isFile() && /\.(?:[cm]?js|ts|css|scss)$/.test(entry.name)) {
            const source = await readFile(path, "utf8");
            for (const match of source.matchAll(
                /(?:^|\n)[\t ]*\/\*([\s\S]*?)\*\//g,
            )) {
                if (!/@license|@preserve|copyright/i.test(match[1])) continue;
                addNotice(label, match[1].replace(/^\s*\* ?/gm, "").trim());
            }
        }
    }
}
for (const path of [...new Set(packages)].sort()) {
    const directory = path;
    const pkg = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
    );
    const files = (await readdir(directory))
        .filter(
            (name) =>
                /^(?:licen[cs]e|copying|copyright|notice)(?:[._-].*)?$/i.test(name) &&
                !(pkg.name === "dompurify" && name === "LICENSE-MPL"),
        )
        .sort();
    if (!files.length) throw new Error(`License file not found: ${pkg.name}`);
    const license =
        pkg.name === "dompurify"
            ? "Apache-2.0 (selected from MPL-2.0 OR Apache-2.0)"
            : pkg.license;
    const label = `${pkg.name} ${pkg.version} - ${license}`;
    for (const name of files)
        addNotice(label, await readFile(join(directory, name), "utf8"));
    // Preserve embedded notices as well, including the MIT-licensed Material
    // Components code vendored inside SMUI's Apache-2.0 packages.
    if (pkg.name !== "vite") await collectSourceNotices(directory, label);
}
addNotice(
    "Dashboard Icons - https://github.com/homarr-labs/dashboard-icons\nChanges: SVG sanitization, background/size adjustment, PNG conversion.",
    await readFile(join(root, "third-party/dashboard-icons/LICENSE"), "utf8"),
);
const output = join(root, "public/licenses");
await mkdir(output, { recursive: true });
// text/plainの配信時にcharsetが付かなくても、UTF-8として判別できるようBOMを付ける。
await writeFile(
    join(output, "THIRD_PARTY_NOTICES.txt"),
    "\uFEFFLicenses and notices\n\n" + [...notices.values()]
        .map(({ text, labels }) => `${[...labels].join("\n")}\n\n${text}`)
        .join("\n\n" + "=".repeat(72) + "\n\n") + "\n",
    "utf8",
);
console.log(`Generated license notices for ${packages.length} packages.`);
