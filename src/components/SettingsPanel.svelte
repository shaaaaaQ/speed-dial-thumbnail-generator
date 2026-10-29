<script lang="ts">
    import Button, { Label } from "@smui/button";
    import Checkbox from "@smui/checkbox";
    import FormField from "@smui/form-field";
    import Slider from "@smui/slider";
    import Textfield from "@smui/textfield";
    import { defaults, settingsFor, type Notify, type Settings } from "../domain/model";
    import type { Studio } from "../state/workspace.svelte";

    let { studio, notify }: { studio: Studio; notify: Notify } = $props();
    let scope = $state<"common" | "individual">("common");
    let colorText = $state("#FFFFFF");

    const current = $derived(studio.current);
    const editSettings = $derived(
        scope === "individual" && current
            ? settingsFor(current, studio.workspace.common)
            : studio.workspace.common,
    );
    const disabledSettings = $derived(scope === "individual" && !current?.override);
    const swatches = ["#FFFFFF", "#F3F1EC", "#E6EDE8", "#DCE6EF", "#25272B", "#000000"];

    $effect(() => {
        colorText = editSettings.background.toUpperCase();
    });
    $effect(() => {
        if (studio.workspace.items.length === 0) {
            scope = "common";
        }
    });

    function update(patch: Partial<Settings>) {
        const settingsToUpdate = scope === "individual" ? current?.override : studio.workspace.common;
        if (settingsToUpdate) {
            Object.assign(settingsToUpdate, patch);
        }
    }

    function toggleOverride(event: Event) {
        if (!current) {
            return;
        }
        const checkbox = event.currentTarget as HTMLInputElement;
        current.override = checkbox.checked ? { ...studio.workspace.common } : undefined;
    }

    function updateNumber(
        event: Event,
        key: "width" | "height" | "logoSize",
        commit = false,
    ) {
        const input = event.target as HTMLInputElement;
        const value = Number(input.value);
        const minimum = key === "logoSize" ? 16 : 64;
        const isValid = input.value !== "" && Number.isInteger(value) && value >= minimum && value <= 4096;

        if (isValid) {
            update({ [key]: value });
        } else if (commit) {
            input.value = String(editSettings[key]);
            notify(`${minimum}〜4096の整数を入力してください。`, true);
        }
    }

    function updateColor(commit = false) {
        if (/^#[0-9a-f]{6}$/i.test(colorText)) {
            update({ background: colorText.toUpperCase() });
        } else if (commit) {
            colorText = editSettings.background.toUpperCase();
            notify("背景色は #FFFFFF の形式で入力してください。", true);
        }
    }
</script>

<section class="settings panel" aria-labelledby="settings-title">
    <div class="section-heading">
        <h2 id="settings-title">設定</h2>
    </div>
    <div class="scope-tabs" role="group" aria-label="設定対象">
        <Button
            onclick={() => (scope = "common")}
            aria-pressed={scope === "common"}
        >
            <Label>すべて共通</Label>
        </Button>
        <Button
            onclick={() => (scope = "individual")}
            aria-pressed={scope === "individual"}
            disabled={!current}
        >
            <Label>このアイコン</Label>
        </Button>
    </div>
    {#if scope === "individual"}
        <div class="override-toggle">
            <FormField>
                <Checkbox checked={Boolean(current?.override)} input$onchange={toggleOverride} />
                {#snippet label()}
                    このアイコンに個別設定を使う
                {/snippet}
            </FormField>
        </div>
    {/if}
    <fieldset disabled={disabledSettings || !studio.ready}>
        <div class="setting-group">
            <h3>背景色</h3>
            <div class="color-control">
                <input
                    id="background"
                    type="color"
                    value={editSettings.background}
                    disabled={disabledSettings || !studio.ready}
                    oninput={(e) =>
                        update({ background: e.currentTarget.value.toUpperCase() })}
                    aria-label="背景色のカラーピッカー"
                />
                <Textfield
                    variant="outlined"
                    noLabel
                    value={colorText}
                    disabled={disabledSettings || !studio.ready}
                    input$maxlength={7}
                    input$aria-label="背景色のHEXコード"
                    input$spellcheck={false}
                    input$oninput={(e) => {
                        colorText = e.currentTarget.value;
                        updateColor();
                    }}
                    input$onchange={() => updateColor(true)}
                />
            </div>
            <div class="swatches">
                {#each swatches as color}
                    <button
                        type="button"
                        onclick={() => update({ background: color })}
                        style={`--swatch:${color}`}
                        title={color}
                        aria-label={`背景色 ${color}`}
                        aria-pressed={editSettings.background.toUpperCase() === color}
                    ></button>
                {/each}
            </div>
        </div>
        <div class="setting-group">
            <h3>ロゴサイズ</h3>
            <Textfield
                class="size-field"
                variant="outlined"
                noLabel
                type="number"
                value={editSettings.logoSize}
                suffix="px"
                disabled={disabledSettings || !studio.ready}
                input$min={16}
                input$max={4096}
                input$aria-label="ロゴサイズの数値"
                input$oninput={(e) => updateNumber(e, "logoSize")}
                input$onchange={(e) => updateNumber(e, "logoSize", true)}
            />
            <Slider
                value={editSettings.logoSize}
                onSMUISliderInput={(e) => update({ logoSize: e.detail.value })}
                min={16}
                max={Math.max(
                    512,
                    editSettings.logoSize,
                    editSettings.width,
                    editSettings.height,
                )}
                disabled={disabledSettings || !studio.ready}
                input$aria-label="ロゴサイズ"
            />
        </div>
        <div class="setting-group">
            <h3>出力サイズ</h3>
            <div class="dimensions">
                <Textfield
                    variant="outlined"
                    label="幅"
                    type="number"
                    value={editSettings.width}
                    suffix="px"
                    disabled={disabledSettings || !studio.ready}
                    input$min={64}
                    input$max={4096}
                    input$step={1}
                    input$aria-label="出力の幅"
                    input$oninput={(e) => updateNumber(e, "width")}
                    input$onchange={(e) => updateNumber(e, "width", true)}
                />
                <span>×</span>
                <Textfield
                    variant="outlined"
                    label="高さ"
                    type="number"
                    value={editSettings.height}
                    suffix="px"
                    disabled={disabledSettings || !studio.ready}
                    input$min={64}
                    input$max={4096}
                    input$step={1}
                    input$aria-label="出力の高さ"
                    input$oninput={(e) => updateNumber(e, "height")}
                    input$onchange={(e) => updateNumber(e, "height", true)}
                />
            </div>
            <p class="field-help">64〜4096 px</p>
        </div>
        <Button
            onclick={() => update({ ...defaults })}
            disabled={disabledSettings || !studio.ready}
        >
            <Label>初期値に戻す</Label>
        </Button>
    </fieldset>
</section>

<style>
    .scope-tabs {
        display: flex;
        margin: 0 20px;
        border-bottom: 1px solid var(--divider);
    }

    .scope-tabs :global(.mdc-button) {
        flex: 1;
        border-radius: 0;
        height: 48px;
        font-size: 13px;
    }

    .scope-tabs :global(.mdc-button[aria-pressed="true"]) {
        color: var(--primary);
        border-bottom: 2px solid var(--primary);
    }

    .override-toggle {
        margin: 8px 12px 0;
    }

    .override-toggle :global(.mdc-form-field) {
        color: var(--text);
        font-size: 13px;
    }

    fieldset {
        border: 0;
        padding: 24px 20px 20px;
        margin: 0;
        min-width: 0;
    }

    .setting-group {
        margin-bottom: 28px;
    }

    .setting-group h3 {
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 16px;
    }

    .color-control {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    input[type="color"] {
        width: 48px;
        height: 48px;
        border: 1px solid var(--divider);
        border-radius: 4px;
        padding: 4px;
        background: var(--surface);
        cursor: pointer;
        flex-shrink: 0;
    }

    input[type="color"]:disabled {
        opacity: 0.5;
        cursor: default;
    }

    input[type="color"]::-webkit-color-swatch-wrapper {
        padding: 0;
    }

    input[type="color"]::-webkit-color-swatch {
        border: 0;
        border-radius: 2px;
    }

    .swatches {
        display: flex;
        gap: 12px;
        margin-top: 16px;
        padding: 3px;
    }

    .swatches button {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid #88888866;
        background: var(--swatch);
        position: relative;
    }

    .swatches button[aria-pressed="true"]:after {
        content: "";
        position: absolute;
        inset: -4px;
        border: 2px solid var(--primary);
        border-radius: 50%;
    }

    fieldset:disabled .swatches {
        opacity: 0.5;
    }

    .dimensions {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .dimensions > :global(.mdc-text-field) {
        flex: 1;
        min-width: 0;
        padding: 0 10px;
    }

    .dimensions > span {
        color: var(--muted);
    }

    .field-help {
        font-size: 12px;
        color: var(--muted);
        margin-top: 8px;
    }

    @media (max-width: 1180px) {
        fieldset {
            padding-left: 16px;
            padding-right: 16px;
        }

        .scope-tabs {
            margin-left: 16px;
            margin-right: 16px;
        }
    }

    @media (max-width: 960px) {
        .settings {
            grid-column: 2;
        }

        .settings fieldset {
            display: grid;
            grid-template-columns: 1fr 1fr;
            column-gap: 24px;
        }

        .settings .setting-group:last-of-type {
            grid-column: 1/-1;
        }

        .settings .dimensions {
            max-width: 340px;
        }

        .settings fieldset > :global(.mdc-button) {
            justify-self: start;
        }

        .scope-tabs {
            max-width: 320px;
        }
    }

    @media (max-width: 640px) {
        .settings fieldset {
            display: block;
        }

        .settings .dimensions {
            max-width: none;
        }

        .setting-group {
            margin-bottom: 24px;
        }

        .swatches {
            gap: 16px;
        }

    }
</style>
