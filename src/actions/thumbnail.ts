import { CDN, FALLBACK } from "../domain/model";

/** 表示範囲に入ったプレビューを取得し、失敗時は本体取得と同じ代替配信元へ切り替える。 */
export function thumbnail(image: HTMLImageElement, file: string) {
    let usingFallback = false;

    function handleImageError() {
        if (!usingFallback) {
            usingFallback = true;
            image.src = `${FALLBACK}/svg/${file}`;
            return;
        }
        image.style.visibility = "hidden";
        if (image.parentElement) {
            image.parentElement.dataset.unavailable = "プレビューなし";
        }
    }

    image.addEventListener("error", handleImageError);
    const observer = new IntersectionObserver(entries => {
        const isVisible = entries.some(entry => entry.isIntersecting);
        if (isVisible) {
            image.src = `${CDN}/svg/${file}`;
            observer.disconnect();
        }
    }, {
        root: image.closest(".catalog-results"),
        rootMargin: "40px",
    });
    observer.observe(image);

    return {
        destroy() {
            observer.disconnect();
            image.removeEventListener("error", handleImageError);
            image.removeAttribute("src");
        },
    };
}
