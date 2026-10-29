<script lang="ts">
    import Button, { Label } from "@smui/button";
    import IconButton from "@smui/icon-button";
    import Textfield from "@smui/textfield";
    import { thumbnail } from "../actions/thumbnail";
    import { getMessage } from "../domain/model";
    import { catalog as fetchCatalog } from "../services/catalog";
    import type { Studio } from "../state/workspace.svelte";
    import Icon from "./Icon.svelte";

    const PAGE_SIZE = 48;

    let { studio }: { studio: Studio } = $props();
    let dialog: HTMLDialogElement;
    let searchInput: { focus(): void };
    let modalOpen = $state(false);
    let catalogLoading = $state(false);
    let catalogFiles = $state<string[]>([]);
    let catalogError = $state("");
    let catalogNote = $state("");
    let addedMessage = $state("");
    let searchQuery = $state("");
    let currentPage = $state(1);

    const searchKey = $derived(searchQuery.trim().toLowerCase().replace(/[\s_-]+/g, ""));
    const matchingFiles = $derived(
        catalogFiles.filter(file => file.replace(/[\s_-]+/g, "").includes(searchKey)),
    );
    const totalPages = $derived(Math.max(1, Math.ceil(matchingFiles.length / PAGE_SIZE)));
    const visibleFiles = $derived(
        matchingFiles.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    );
    const catalogStatus = $derived(
        catalogLoading
            ? "読み込み中…"
            : catalogError || catalogNote || `${matchingFiles.length.toLocaleString()}件`,
    );
    const emptyMessage = $derived.by(() => {
        if (catalogLoading) {
            return "読み込み中…";
        }
        if (catalogError) {
            return "一覧を取得できませんでした";
        }
        return "該当するアイコンがありません";
    });

    async function loadCatalog(force = false) {
        if (catalogLoading) {
            return;
        }
        catalogLoading = true;
        catalogError = "";
        catalogNote = "";

        try {
            const result = await fetchCatalog(force);
            catalogFiles = result.files;
            currentPage = 1;
            catalogNote = result.stale
                ? "最新の一覧を取得できないため、以前の一覧を表示しています。"
                : "";
        } catch (error) {
            catalogError = getMessage(error);
        } finally {
            catalogLoading = false;
        }
    }

    export function open() {
        dialog.showModal();
        modalOpen = true;
        searchInput.focus();
        addedMessage = "";
        if (catalogFiles.length === 0) {
            void loadCatalog();
        }
    }

    function closeCatalog() {
        dialog.close();
        modalOpen = false;
    }

    function handleBackdropClick(event: MouseEvent) {
        if (event.target !== dialog) {
            return;
        }
        const bounds = dialog.getBoundingClientRect();
        const isOutside = event.clientX < bounds.left || event.clientX > bounds.right
            || event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (isOutside) {
            closeCatalog();
        }
    }

    async function toggleRemote(file: string) {
        addedMessage = await studio.toggleRemote(file);
    }
</script>

<dialog
    bind:this={dialog}
    aria-labelledby="catalog-title"
    onclose={() => (modalOpen = false)}
    onclick={handleBackdropClick}
>
    <div class="dialog-header">
        <h2 id="catalog-title">Dashboard Icons</h2>
        <IconButton onclick={closeCatalog} aria-label="閉じる">
            <Icon name="close" />
        </IconButton>
    </div>

    <Textfield
        bind:this={searchInput}
        class="catalog-search"
        variant="outlined"
        label="アイコンを検索"
        bind:value={searchQuery}
        type="search"
        input$aria-label="アイコンを検索"
        input$autocomplete="off"
        input$oninput={() => (currentPage = 1)}
    />
    <div class="catalog-meta">
        <span role="status">{catalogStatus}</span>
        <Button onclick={() => loadCatalog(true)} disabled={catalogLoading}>
            <Label>一覧を更新</Label>
        </Button>
    </div>

    <div class="catalog-results">
        {#if modalOpen}
            {#each visibleFiles as file (file)}
                {@const added = studio.workspace.items.some(item => item.remote === file)}
                {@const iconName = file.slice(0, -4)}
                <button
                    class="catalog-card"
                    class:added
                    aria-pressed={added}
                    title={`${iconName}${added ? "（クリックで解除）" : ""}`}
                    aria-label={`${iconName}${added ? "の選択を解除" : "を追加"}`}
                    onclick={() => toggleRemote(file)}
                >
                    <span class="catalog-image">
                        <img
                            use:thumbnail={file}
                            alt=""
                            width="44"
                            height="44"
                            referrerpolicy="no-referrer"
                        />
                    </span>
                    <span>{iconName}</span>
                    <i>
                        <Icon name={added ? "check" : "plus"} size={16} />
                    </i>
                </button>
            {:else}
                <div class="catalog-empty">
                    <Icon name="search" size={28} />
                    <p>{emptyMessage}</p>
                </div>
            {/each}
        {/if}
    </div>

    <div class="catalog-pagination">
        <Button disabled={currentPage <= 1} onclick={() => currentPage--}>
            <Label>前へ</Label>
        </Button>
        <span>{currentPage} / {totalPages}</span>
        <Button disabled={currentPage >= totalPages} onclick={() => currentPage++}>
            <Label>次へ</Label>
        </Button>
    </div>
    {#if addedMessage}
        <div class="dialog-footer" role="status">{addedMessage}</div>
    {/if}
</dialog>

<style>
    dialog {
        background: var(--surface);
        color: var(--text);
        border: 0;
        border-radius: 4px;
        width: 760px;
        max-width: calc(100vw - 32px);
        max-height: calc(100dvh - 48px);
        padding: 16px 24px 20px;
        box-shadow: 0 12px 32px #0004;
        overflow: auto;
    }

    dialog::backdrop {
        background: #0008;
    }

    .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
    }

    .dialog-header h2 {
        font-size: 20px;
    }


    .catalog-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        color: var(--muted);
        min-height: 56px;
    }

    .catalog-meta > span {
        flex: 1;
    }

    .catalog-results {
        height: min(400px, 45dvh);
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        grid-auto-rows: 112px;
        gap: 8px;
        overflow: auto;
        align-content: start;
        padding: 2px;
        scrollbar-width: thin;
    }

    .catalog-card {
        background: var(--surface);
        color: var(--text);
        border: 1px solid var(--divider);
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        position: relative;
        min-width: 0;
        padding: 12px 6px;
    }

    .catalog-card:hover {
        background: var(--stage);
    }

    .catalog-card.added {
        background: var(--selected);
        border-color: var(--primary);
    }

    .catalog-card > span:nth-child(2) {
        font-size: 11px;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .catalog-image {
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        position: relative;
    }

    .catalog-image img {
        object-fit: contain;
    }

    .catalog-image:after {
        content: attr(data-unavailable);
        position: absolute;
        color: var(--muted);
        font-size: 9px;
        white-space: nowrap;
    }

    .catalog-card i {
        position: absolute;
        right: 5px;
        top: 4px;
        color: var(--primary);
        display: none;
    }

    .catalog-card.added i,
    .catalog-card:hover i {
        display: block;
    }

    .catalog-pagination {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 16px;
        padding-top: 16px;
        font-size: 12px;
        color: var(--muted);
    }

    .dialog-footer {
        font-size: 12px;
        color: var(--muted);
        padding-top: 12px;
        overflow-wrap: anywhere;
    }

    .catalog-empty {
        grid-column: 1/-1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 240px;
        gap: 16px;
        text-align: center;
        color: var(--muted);
    }

    @media (max-width: 640px) {
        dialog {
            padding: 12px 16px 16px;
            max-width: calc(100vw - 24px);
        }

        .catalog-results {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            height: 43dvh;
        }

        .catalog-meta :global(.mdc-button) {
            font-size: 12px;
        }
    }
</style>
