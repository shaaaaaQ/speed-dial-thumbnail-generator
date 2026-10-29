<script lang="ts">
    import Button, { Label } from "@smui/button";
    import { paint } from "../actions/paint";
    import { settingsFor } from "../domain/model";
    import type { Studio } from "../state/workspace.svelte";
    import Icon from "./Icon.svelte";

    type Props = {
        studio: Studio;
        exporting: boolean;
        onExport: () => void;
    };

    let { studio, exporting, onExport }: Props = $props();
    const current = $derived(studio.current);
    const previewSettings = $derived(
        current ? settingsFor(current, studio.workspace.common) : studio.workspace.common,
    );
    const sourceDescription = $derived.by(() => {
        if (!current) {
            return "";
        }
        if (current.source === "dashboard") {
            return `Dashboard Icons / SVG${current.error ? " · 取得失敗" : ""}`;
        }
        const fileSize = current.blob ? ` / ${formatBytes(current.blob.size)}` : " · 画像データなし";
        return `ローカル画像${fileSize}`;
    });

    function formatBytes(bytes: number) {
        if (bytes < 1024 * 1024) {
            return `${Math.ceil(bytes / 1024)} KB`;
        }
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function retryCurrentImage() {
        if (current) {
            void studio.loadItem(current, true);
        }
    }
</script>

<section class="editor panel" aria-labelledby="preview-title">
    <div class="section-heading">
        <h2 id="preview-title">プレビュー</h2>
        <span class="dimensions-label">
            {previewSettings.width} × {previewSettings.height} px
        </span>
    </div>

    <div class="preview-stage">
        <div class="canvas-wrap">
            <canvas
                id="preview"
                use:paint={{
                    img: current ? studio.images[current.id] : undefined,
                    settings: { ...previewSettings },
                }}
                aria-label="書き出し画像のプレビュー"
            ></canvas>
            {#if !current || !studio.images[current.id]}
                <div class="preview-empty">
                    <Icon name="image" size={36} />
                    {#if current?.error}
                        <strong>画像を読み込めませんでした</strong>
                        <span>{current.error}</span>
                        {#if current.remote}
                            <Button variant="outlined" onclick={retryCurrentImage}>
                                <Label>再試行</Label>
                            </Button>
                        {:else}
                            <span>画像を追加し直してください。</span>
                        {/if}
                    {:else if current}
                        <span>読み込み中…</span>
                    {:else}
                        <span>アイコンを追加してください</span>
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <div class="selected-detail">
        <div>
            <h3>{current?.name ?? "未選択"}</h3>
            <p>{sourceDescription}</p>
        </div>
        <Button
            variant="unelevated"
            disabled={!current || !studio.images[current.id] || exporting}
            onclick={onExport}
        >
            <Icon name="down" />
            <Label>PNGを保存</Label>
        </Button>
    </div>
</section>

<style>
    .dimensions-label {
        font-size: 12px;
        white-space: nowrap;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
    }

    @media (max-width: 640px) {
        .dimensions-label {
            font-size: 11px;
        }
    }

    .preview-stage {
        height: 440px;
        padding: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--stage);
        overflow: hidden;
    }

    .canvas-wrap {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        max-height: 100%;
        max-width: 100%;
    }

    #preview {
        display: block;
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
        object-fit: contain;
        box-shadow: 0 2px 6px #00000026;
    }

    .preview-empty {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        background: var(--stage);
        color: var(--muted);
        text-align: center;
        padding: 12px;
        overflow: auto;
    }

    .preview-empty span {
        font-size: 14px;
        overflow-wrap: anywhere;
    }

    .preview-empty strong {
        font-size: 14px;
        font-weight: 500;
    }

    .selected-detail {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 20px;
    }

    .selected-detail > div {
        min-width: 0;
    }

    .selected-detail h3 {
        font-size: 16px;
        font-weight: 400;
        overflow-wrap: anywhere;
    }

    .selected-detail p {
        font-size: 12px;
        color: var(--muted);
        margin-top: 4px;
    }

    .selected-detail :global(.mdc-button) {
        flex-shrink: 0;
    }

    @media (min-width: 1500px) {
        .preview-stage {
            height: 520px;
        }
    }

    @media (max-width: 1180px) {
        .selected-detail {
            padding: 16px;
            flex-wrap: wrap;
        }

        .preview-stage {
            height: 400px;
            padding: 24px;
        }
    }

    @media (max-width: 960px) {
        .editor {
            grid-column: 2;
        }

        .preview-stage {
            height: 360px;
        }
    }

    @media (max-width: 640px) {
        .preview-stage {
            height: 320px;
            padding: 20px;
        }

        .selected-detail {
            flex-wrap: nowrap;
        }

        .selected-detail h3 {
            font-size: 14px;
        }

        .selected-detail p {
            font-size: 11px;
        }

        .selected-detail :global(.mdc-button) {
            font-size: 12px;
            padding: 0 12px;
        }
    }
</style>
