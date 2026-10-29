<script lang="ts">
    import { Icon as SMUIIcon } from "@smui/icon-button";
    import {
        mdiCheck,
        mdiClose,
        mdiDeleteOutline,
        mdiDownload,
        mdiImageOutline,
        mdiMagnify,
        mdiPlus,
        mdiUpload,
        mdiWhiteBalanceSunny,
    } from "@mdi/js";

    const iconPaths = {
        plus: mdiPlus,
        search: mdiMagnify,
        upload: mdiUpload,
        down: mdiDownload,
        sun: mdiWhiteBalanceSunny,
        trash: mdiDeleteOutline,
        close: mdiClose,
        check: mdiCheck,
        image: mdiImageOutline,
    };

    type Props = {
        name: keyof typeof iconPaths;
        size?: number;
    };

    let { name, size = 24 }: Props = $props();
</script>

<SMUIIcon tag="svg" viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
    <path d={iconPaths[name]} />
</SMUIIcon>
