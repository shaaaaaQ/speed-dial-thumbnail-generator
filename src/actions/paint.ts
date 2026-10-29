import type { Settings } from "../domain/model";
import { draw } from "../services/images";

type PaintOptions = {
    img?: HTMLImageElement;
    settings: Settings;
    small?: boolean;
};

export function paint(canvas: HTMLCanvasElement, options: PaintOptions) {
    function render({ img, settings, small }: PaintOptions) {
        const scale = small ? 100 / Math.max(settings.width, settings.height) : 1;
        draw(canvas, img, {
            ...settings,
            width: Math.max(1, Math.round(settings.width * scale)),
            height: Math.max(1, Math.round(settings.height * scale)),
            logoSize: settings.logoSize * scale,
        });
    }

    render(options);
    return {
        update: render,
        destroy() {
            canvas.width = 0;
            canvas.height = 0;
        },
    };
}
