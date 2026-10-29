<script lang="ts">
    import { onMount } from "svelte";
    import IconButton from "@smui/icon-button";
    import CatalogDialog from "./components/CatalogDialog.svelte";
    import Icon from "./components/Icon.svelte";
    import LibraryPanel from "./components/LibraryPanel.svelte";
    import PreviewPanel from "./components/PreviewPanel.svelte";
    import SettingsPanel from "./components/SettingsPanel.svelte";
    import { getMessage, settingsFor } from "./domain/model";
    import { exportImages } from "./services/export";
    import { createPersistence } from "./services/persistence";
    import { Studio } from "./state/workspace.svelte";

    let notice = $state("");
    let noticeError = $state(false);
    let exporting = $state(false);
    let progress = $state("");
    let theme = $state(document.documentElement.dataset.theme ?? "auto");
    let catalogDialog: CatalogDialog;

    const studio = new Studio(notify);
    const persistence = createPersistence(notify);
    const themeLabels: Record<string, string> = {
        auto: "システム",
        light: "ライト",
        dark: "ダーク",
    };

    function notify(text: string, error = false) {
        notice = text;
        noticeError = error;
    }

    $effect(() => {
        const snapshot = $state.snapshot(studio.workspace);
        if (studio.ready) {
            return persistence.schedule(snapshot);
        }
    });

    onMount(() => {
        let disposed = false;

        async function restoreWorkspace() {
            const savedWorkspace = await persistence.restore();
            if (disposed) {
                return;
            }
            if (savedWorkspace) {
                studio.workspace = savedWorkspace;
            }
            studio.ready = true;
            void studio.restoreImages();
        }

        function flushWorkspace() {
            if (studio.ready) {
                persistence.flush($state.snapshot(studio.workspace));
            }
        }

        function handleVisibilityChange() {
            if (document.visibilityState === "hidden") {
                flushWorkspace();
            }
        }

        function preventBrowserDrop(event: DragEvent) {
            event.preventDefault();
        }

        void restoreWorkspace();
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("pagehide", flushWorkspace);
        window.addEventListener("dragover", preventBrowserDrop);
        window.addEventListener("drop", preventBrowserDrop);

        return () => {
            disposed = true;
            flushWorkspace();
            persistence.dispose();
            studio.dispose();
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("pagehide", flushWorkspace);
            window.removeEventListener("dragover", preventBrowserDrop);
            window.removeEventListener("drop", preventBrowserDrop);
        };
    });

    async function saveImages(exportAll: boolean) {
        if (exporting) {
            return;
        }
        exporting = true;

        const selectedItems = studio.current ? [studio.current] : [];
        const itemsToExport = exportAll ? studio.workspace.items : selectedItems;
        const targets = itemsToExport.map(item => ({
            item: { ...item },
            settings: { ...settingsFor(item, studio.workspace.common) },
            img: studio.images[item.id],
        }));

        try {
            const result = await exportImages(targets, exportAll, value => {
                progress = value;
            });
            notify(result.message, result.failed.length > 0);
        } catch (error) {
            notify(`書き出しに失敗しました。${getMessage(error)}`, true);
        } finally {
            exporting = false;
            progress = "";
        }
    }

    function toggleTheme() {
        const themes = ["auto", "light", "dark"];
        const nextIndex = (themes.indexOf(theme) + 1) % themes.length;
        theme = themes[nextIndex];
        document.documentElement.dataset.theme = theme;

        try {
            localStorage.setItem("dial-theme", theme);
        } catch {
            notify("テーマを保存できません。このタブでのみ反映されます。", true);
        }
    }
</script>

<header class="app-bar">
    <div class="app-actions">
        <IconButton
            onclick={toggleTheme}
            aria-label={`表示テーマ: ${themeLabels[theme]}。クリックで切り替え`}
            title={`テーマ: ${themeLabels[theme]}`}
        >
            <Icon name="sun" size={24} />
        </IconButton>
    </div>
</header>

<main>
    {#if notice}
        <div class="notice" class:error={noticeError} role="status">
            <span>{notice}</span>
            <IconButton aria-label="通知を閉じる" onclick={() => (notice = "")}>
                <Icon name="close" />
            </IconButton>
        </div>
    {/if}

    <div class="workspace">
        <LibraryPanel
            {studio}
            {exporting}
            {progress}
            onCatalog={() => catalogDialog.open()}
            onExport={() => saveImages(true)}
        />
        <PreviewPanel {studio} {exporting} onExport={() => saveImages(false)} />
        <SettingsPanel {studio} {notify} />
    </div>

    <footer>
        <a
            href={`${import.meta.env.BASE_URL}licenses/THIRD_PARTY_NOTICES.txt`}
            target="_blank"
            rel="noreferrer"
        >
            ライセンス
        </a>
        <a
            href="https://github.com/homarr-labs/dashboard-icons"
            target="_blank"
            rel="noreferrer"
        >
            Dashboard Icons
        </a>
    </footer>
</main>

<CatalogDialog bind:this={catalogDialog} {studio} />

<style>
    .app-bar {
        height: 64px;
        padding: 0 24px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 16px;
        background: var(--surface);
        box-shadow: 0 2px 4px #00000026;
    }

    .app-actions {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    main {
        padding: 24px;
        max-width: 1600px;
        margin: 0 auto;
    }

    .workspace {
        display: grid;
        grid-template-columns: 272px minmax(320px, 1fr) 312px;
        gap: 24px;
        align-items: start;
    }

    .notice {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
        padding: 4px 8px 4px 16px;
        border-radius: 4px;
        background: var(--selected);
        color: var(--text);
        overflow-wrap: anywhere;
    }

    .notice > span {
        flex: 1;
        min-width: 0;
        font-size: 14px;
    }

    .notice.error {
        background: var(--surface);
        color: var(--error);
        border-left: 4px solid var(--error);
    }

    footer {
        display: flex;
        align-items: center;
        gap: 16px;
        justify-content: flex-end;
        padding-top: 20px;
        font-size: 12px;
    }

    footer a {
        color: var(--muted);
    }

    @media (max-width: 1180px) {
        .workspace {
            grid-template-columns: 240px minmax(280px, 1fr) 280px;
            gap: 16px;
        }

        main {
            padding: 20px 16px;
        }
    }

    @media (max-width: 960px) {
        .workspace {
            grid-template-columns: 240px minmax(0, 1fr);
        }
    }

    @media (max-width: 640px) {
        .app-bar {
            padding: 0 16px;
            height: 56px;
        }

        .app-actions {
            gap: 4px;
        }

        main {
            padding: 16px 12px;
        }

        .workspace {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .notice > span {
            font-size: 12px;
        }
    }
</style>
