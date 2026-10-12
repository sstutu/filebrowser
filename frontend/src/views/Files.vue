<template>
  <div>
    <header-bar
      v-if="error || fileStore.req?.type === undefined"
      showMenu
      showLogo
    />

    <breadcrumbs base="/files">
      <div v-if="showCopyActions" class="public-copy-actions">
        <button
          type="button"
          :disabled="copyDisabled"
          @click="listingView?.copyPublicLinks('links')"
        >
          复制公网链接
        </button>
        <button
          type="button"
          :disabled="copyDisabled"
          @click="listingView?.copyPublicLinks('table')"
        >
          复制文件名＋链接表格
        </button>
        <span role="status">
          {{
            publicLinks.copying
              ? "复制中…"
              : `已选 ${fileStore.selected.length} 项`
          }}
        </span>
      </div>
    </breadcrumbs>
    <errors v-if="error" :errorCode="error.status" />
    <component
      v-else-if="currentView"
      :is="currentView"
      ref="listingView"
    ></component>
    <div v-else>
      <h2 class="message delayed">
        <div class="spinner">
          <div class="bounce1"></div>
          <div class="bounce2"></div>
          <div class="bounce3"></div>
        </div>
        <span>{{ t("files.loading") }}</span>
      </h2>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { files as api } from "@/api";
import { storeToRefs } from "pinia";
import { useFileStore } from "@/stores/file";
import { useLayoutStore } from "@/stores/layout";
import { useAuthStore } from "@/stores/auth";
import { usePublicLinksStore } from "@/stores/public-links";

import HeaderBar from "@/components/header/HeaderBar.vue";
import Breadcrumbs from "@/components/Breadcrumbs.vue";
import Errors from "@/views/Errors.vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import FileListing from "@/views/files/FileListing.vue";
import { StatusError } from "@/api/utils";
import { name } from "../utils/constants";

const Editor = defineAsyncComponent(() => import("@/views/files/Editor.vue"));
const Preview = defineAsyncComponent(() => import("@/views/files/Preview.vue"));

const layoutStore = useLayoutStore();
const fileStore = useFileStore();
const authStore = useAuthStore();
const publicLinks = usePublicLinksStore();
const listingView = ref<{
  copyPublicLinks: (mode: "links" | "table") => Promise<void>;
} | null>(null);
const showCopyActions = computed(
  () =>
    !error.value &&
    !layoutStore.loading &&
    fileStore.req?.isDir &&
    authStore.user?.perm.share &&
    authStore.user.perm.download
);
const copyDisabled = computed(
  () => !fileStore.selected.length || publicLinks.busy || publicLinks.copying
);

const { reload } = storeToRefs(fileStore);

const route = useRoute();

const { t } = useI18n({});

let fetchDataController = new AbortController();

const error = ref<StatusError | null>(null);

const currentView = computed(() => {
  if (fileStore.req?.type === undefined) {
    return null;
  }

  if (fileStore.req.isDir) {
    return FileListing;
  } else if (fileStore.req.extension.toLowerCase() === ".csv") {
    // CSV files use Preview for table view, unless ?edit=true
    if (route.query.edit === "true") {
      return Editor;
    }
    return Preview;
  } else if (
    fileStore.req.type === "text" ||
    fileStore.req.type === "textImmutable"
  ) {
    return Editor;
  } else {
    return Preview;
  }
});

// Define hooks
onMounted(() => {
  fetchData();
  fileStore.isFiles = true;
  window.addEventListener("keydown", keyEvent);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", keyEvent);
});

onUnmounted(() => {
  fileStore.isFiles = false;
  if (layoutStore.showShell) {
    layoutStore.toggleShell();
  }
  fileStore.updateRequest(null);
  fetchDataController.abort();
});

watch(route, () => {
  fetchData();
});
watch(reload, (newValue) => {
  newValue && fetchData();
});

// Define functions

const applyPreSelection = () => {
  const preselect = fileStore.preselect;
  fileStore.preselect = null;

  if (!fileStore.req?.isDir || fileStore.oldReq === null) return;

  let index = -1;
  if (preselect) {
    // Find item with the specified path
    index = fileStore.req.items.findIndex((item) => item.path === preselect);
  } else if (fileStore.oldReq.path.startsWith(fileStore.req.path)) {
    // Get immediate child folder of the previous path
    const name = fileStore.oldReq.path
      .substring(fileStore.req.path.length)
      .split("/")
      .shift();

    index = fileStore.req.items.findIndex(
      (val) => val.path == fileStore.req!.path + name
    );
  }

  if (index === -1) return;
  fileStore.selected.push(index);
};

const fetchData = async () => {
  // Reset view information.
  fileStore.reload = false;
  fileStore.selected = [];
  fileStore.multiple = false;
  layoutStore.closeHovers();

  // Set loading to true and reset the error.
  layoutStore.loading = true;
  error.value = null;

  let url = route.path;
  if (url === "") url = "/";
  if (url[0] !== "/") url = "/" + url;
  // Cancel the ongoing request
  fetchDataController.abort();
  fetchDataController = new AbortController();
  try {
    const res = await api.fetch(url, fetchDataController.signal);
    fileStore.updateRequest(res);
    document.title = `${res.name || t("sidebar.myFiles")} - ${t("files.files")} - ${name}`;
    layoutStore.loading = false;

    // Selects the post-reload target item or the previously visited child folder
    applyPreSelection();
  } catch (err) {
    if (err instanceof StatusError && err.is_canceled) {
      return;
    }
    if (err instanceof Error) {
      error.value = err;
    }
    layoutStore.loading = false;
  }
};
const keyEvent = (event: KeyboardEvent) => {
  if (event.key === "F1") {
    event.preventDefault();
    layoutStore.showHover("help");
  }
};
</script>

<style scoped>
.public-copy-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-inline-start: auto;
  padding-inline: 0.75rem;
}

.public-copy-actions button {
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--divider);
  border-radius: 0.25rem;
  background: var(--surfacePrimary, var(--background));
  color: var(--textPrimary);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.public-copy-actions button:hover:not(:disabled) {
  background: var(--divider);
}

.public-copy-actions button:disabled {
  opacity: 0.45;
  cursor: default;
}

.public-copy-actions span {
  font-size: 0.85rem;
  white-space: nowrap;
}

@media (max-width: 736px) {
  :deep(.breadcrumbs) {
    height: auto;
    min-height: 3em;
    flex-wrap: wrap;
  }

  .public-copy-actions {
    flex-wrap: wrap;
    margin-inline-start: 0;
    padding-block: 0.35rem;
  }
}
</style>
