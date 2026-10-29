<script lang="ts">
    import Button, { Label } from "@smui/button";
    import IconButton from "@smui/icon-button";
    import { paint } from "../actions/paint";
    import { settingsFor, type Item } from "../domain/model";
    import type { Studio } from "../state/workspace.svelte";
    import Icon from "./Icon.svelte";

    type Props = {
        studio: Studio;
        exporting: boolean;
        progress: string;
        onCatalog: () => void;
        onExport: () => void;
    };

    let { studio, exporting, progress, onCatalog, onExport }: Props = $props();
    let fileInput: HTMLInputElement;
    let dragging = $state(false);

    function handleFileSelection(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        if (input.files) {
            void studio.addLocal(input.files);
        }
        input.value = "";
    }

    function handleDragOver(event: DragEvent) {
        event.preventDefault();
        dragging = true;
    }

    function handleDrop(event: DragEvent) {
        event.preventDefault();
        dragging = false;
        if (event.dataTransfer?.files) {
            void studio.addLocal(event.dataTransfer.files);
        }
    }

    function itemStatus(item: Item) {
        if (item.error) {
            return "読み込み失敗";
        }
        if (studio.loading[item.id]) {
            return "取得中…";
        }
        return item.override ? "個別設定" : "共通設定";
    }
</script>

<section class="library panel" aria-labelledby="library-title">
    <div class="section-heading">
        <h2 id="library-title">
            アイコン <span class="count">{studio.workspace.items.length}</span>
        </h2>
    </div>

    <div class="library-actions">
        <Button variant="unelevated" onclick={onCatalog} disabled={!studio.ready}>
            <Icon name="plus" />
            <Label>アイコンを探す</Label>
        </Button>
        <Button variant="outlined" onclick={() => fileInput.click()} disabled={!studio.ready}>
            <Icon name="upload" />
            <Label>画像を追加</Label>
        </Button>
        <input
            bind:this={fileInput}
            type="file"
            accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
            multiple
            hidden
            onchange={handleFileSelection}
        />
    </div>

    <div class="items">
        {#each studio.workspace.items as item (item.id)}
            <div class="item-row" class:active={studio.workspace.selected === item.id}>
                <button
                    class="item-select"
                    onclick={() => (studio.workspace.selected = item.id)}
                    aria-pressed={studio.workspace.selected === item.id}
                    aria-label={`${item.name}を編集`}
                >
                    <span class="item-thumb">
                        {#if item.error}
                            <span class="error-text">!</span>
                        {:else if studio.loading[item.id]}
                            <span class="spinner"></span>
                        {:else}
                            <canvas
                                use:paint={{
                                    img: studio.images[item.id],
                                    settings: { ...settingsFor(item, studio.workspace.common) },
                                    small: true,
                                }}
                                aria-hidden="true"
                            ></canvas>
                        {/if}
                    </span>
                    <span class="item-text">
                        <strong>{item.name}</strong>
                        <small class:error-text={Boolean(item.error)}>{itemStatus(item)}</small>
                    </span>
                </button>
                <IconButton
                    class="item-remove"
                    onclick={() => studio.remove(item)}
                    aria-label={`${item.name}を削除`}
                >
                    <Icon name="trash" size={20} />
                </IconButton>
            </div>
        {:else}
            <p class="empty-list">アイコンがありません</p>
        {/each}
    </div>

    <button
        class="dropzone"
        class:dragging
        disabled={!studio.ready}
        onclick={() => fileInput.click()}
        ondragover={handleDragOver}
        ondragleave={() => (dragging = false)}
        ondrop={handleDrop}
    >
        <Icon name="upload" />
        <span>画像をドロップ</span>
        <small>SVG・PNG・WebP / 10MBまで</small>
    </button>
    <p class="library-foot">最大100件・合計50MB</p>

    <div class="library-export">
        <Button variant="outlined" onclick={onExport} disabled={!studio.hasExportable || exporting}>
            <Icon name="down" />
            <Label>{exporting ? progress : "ZIPで保存"}</Label>
        </Button>
    </div>
</section>

<style>
    .count {
        font-size: 14px;
        color: var(--muted);
        margin-left: 8px;
        font-weight: 400;
    }

    .library-actions {
        display: grid;
        gap: 12px;
        padding: 0 20px 20px;
        border-bottom: 1px solid var(--divider);
    }

    .library-actions :global(.mdc-button),
    .library-export :global(.mdc-button) {
        width: 100%;
    }

    .items {
        max-height: 440px;
        min-height: 180px;
        overflow: auto;
        padding: 8px 0;
        scrollbar-width: thin;
    }

    .item-row {
        display: flex;
        align-items: center;
        padding: 4px 8px 4px 16px;
        min-height: 72px;
    }

    .item-row.active {
        background: var(--selected);
    }

    .item-select {
        display: flex;
        align-items: center;
        text-align: left;
        gap: 12px;
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--text);
        padding: 4px 0;
    }

    .item-thumb {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 44px;
        flex-shrink: 0;
        border: 1px solid var(--divider);
        border-radius: 2px;
        background: var(--stage);
        overflow: hidden;
    }

    .item-thumb canvas {
        display: block;
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
    }

    .item-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }

    .item-text strong {
        font-size: 14px;
        font-weight: 400;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .item-text small {
        font-size: 12px;
        color: var(--muted);
    }

    .item-row :global(.item-remove) {
        flex-shrink: 0;
    }

    .empty-list {
        padding: 64px 16px;
        text-align: center;
        color: var(--muted);
        font-size: 14px;
    }

    .dropzone {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        border: 1px dashed var(--divider);
        border-radius: 4px;
        background: transparent;
        color: var(--muted);
        padding: 16px 8px;
        margin: 12px 20px;
        width: calc(100% - 40px);
    }

    .dropzone small {
        font-size: 11px;
    }

    .dropzone:hover,
    .dropzone.dragging {
        background: var(--selected);
        border-color: var(--primary);
        color: var(--primary);
    }

    .library-foot {
        padding: 0 20px 16px;
        font-size: 12px;
        color: var(--muted);
    }

    .library-export {
        padding: 16px 20px;
        border-top: 1px solid var(--divider);
    }

    .spinner {
        width: 18px;
        height: 18px;
        border: 2px solid var(--divider);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    @media (max-width: 1180px) {
        .library-actions {
            padding-left: 16px;
            padding-right: 16px;
        }
    }

    @media (max-width: 960px) {
        .library {
            grid-row: 1/3;
        }
    }

    @media (max-width: 640px) {
        .library-actions {
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }

        .library-actions :global(.mdc-button) {
            font-size: 12px;
            padding: 0 8px;
        }

        .items {
            min-height: 90px;
            max-height: 210px;
        }

        .empty-list {
            padding: 32px 16px;
        }

        .dropzone {
            flex-direction: row;
            justify-content: center;
            flex-wrap: wrap;
            padding: 12px;
            gap: 8px;
        }

        .dropzone small {
            width: 100%;
            text-align: center;
        }

        .library-export {
            padding: 12px 16px;
        }
    }
</style>
