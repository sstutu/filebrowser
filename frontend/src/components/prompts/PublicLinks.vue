<template>
  <div class="card floating public-links">
    <div class="card-title">
      <h2>分享文件</h2>
      <span>已选 {{ selected.length }} 个文件</span>
    </div>
    <div class="card-content">
      <p>
        按所在文件夹共享，一键复制文件直链或表格。文件夹内全部内容（包括以后新增的文件）将无需登录访问。
      </p>
      <label
        ><input
          type="checkbox"
          :checked="allSelected"
          :disabled="working"
          @change="selectAll"
        />
        全选</label
      >
      <div class="table-scroll">
        <table>
          <colgroup>
            <col style="width: 44px" />
            <col style="width: 28%" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th></th>
              <th>文件名</th>
              <th>公网访问链接</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in previewRows" :key="row.url">
              <td>
                <input
                  v-model="row.selected"
                  type="checkbox"
                  :disabled="working"
                  :aria-label="`选择 ${row.name}`"
                />
              </td>
              <td>
                <span :title="row.name">{{ row.name }}</span>
              </td>
              <td>
                <a
                  v-if="row.link"
                  :href="row.link"
                  :title="row.link"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ row.link }}</a
                ><span v-else>{{ row.error || "复制时自动生成" }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="store.rows.length > previewRows.length">
        仅预览前 {{ previewRows.length }} 项，复制包含全部所选项。
      </p>
      <p
        v-if="message"
        class="notice"
        :class="messageType"
        role="status"
        aria-live="polite"
      >
        {{ message }}
      </p>
    </div>
    <div class="card-action">
      <button
        class="button button--flat"
        :disabled="working"
        @click="layout.closeHovers()"
      >
        关闭
      </button>
      <button
        class="button button--flat"
        :disabled="working || !selected.length"
        @click="copySelected('links')"
      >
        {{
          working && activeMode === "links"
            ? "复制中…"
            : copiedMode === "links"
              ? "已复制链接 ✓"
              : "复制公网链接"
        }}
      </button>
      <button
        id="focus-prompt"
        class="button"
        :disabled="working || !selected.length"
        @click="copySelected('table')"
      >
        {{
          working && activeMode === "table"
            ? "复制中…"
            : copiedMode === "table"
              ? "已复制表格 ✓"
              : "复制文件名＋链接表格"
        }}
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { usePublicLinksStore } from "@/stores/public-links";
import { useLayoutStore } from "@/stores/layout";
import { copyPreparedPublicLinks, publicLinksTSV } from "@/utils/public-links";
const store = usePublicLinksStore();
const layout = useLayoutStore();
const message = ref("");
const messageType = ref("progress");
const copying = ref(false);
const activeMode = ref("");
const copiedMode = ref("");
const showSuccess = inject<IToastSuccess>("$showSuccess");
const working = computed(() => copying.value || store.busy);
const selected = computed(() => store.rows.filter((row) => row.selected));
const previewRows = computed(() => store.rows.slice(0, 200));
const allSelected = computed(
  () => store.rows.length > 0 && selected.value.length === store.rows.length
);
watch(
  () => store.rows,
  () => {
    message.value = "";
    copiedMode.value = "";
  }
);
function selectAll(event: Event) {
  for (const row of store.rows)
    row.selected = (event.target as HTMLInputElement).checked;
}
watch(
  () => selected.value.map((row) => row.url).join("\n"),
  () => {
    copiedMode.value = "";
    message.value = "";
  }
);
async function copySelected(mode: "links" | "table") {
  if (working.value || !selected.value.length) return;
  copying.value = true;
  activeMode.value = mode;
  copiedMode.value = "";
  messageType.value = "progress";
  message.value = "正在生成并复制链接…";
  const files = [...selected.value];
  let count = files.length;
  const prepare = async () => {
    await store.generate();
    if (files.some((row) => !row.link))
      throw new Error("部分链接生成失败，请重试或取消勾选失败文件。");
    return mode === "table"
      ? publicLinksTSV(files)
      : files.map((row) => row.link).join("\n");
  };
  try {
    if (mode === "table" && files.some((file) => file.isDir)) {
      count = await store.copyFiles(files, mode);
    } else {
      await copyPreparedPublicLinks(prepare);
    }
    copiedMode.value = mode;
    messageType.value = "success";
    message.value =
      mode === "table"
        ? `✓ 已复制 ${count} 个文件的文件名和链接，可粘贴到 Excel/WPS。`
        : `✓ 已复制 ${count} 个公网链接。`;
    showSuccess?.(message.value);
  } catch (error) {
    messageType.value = "error";
    message.value =
      files.some((row) => !row.link) && error instanceof Error
        ? error.message
        : "复制失败，请使用 HTTPS 或允许浏览器访问剪贴板后重试。";
  } finally {
    copying.value = false;
  }
}
</script>
<style scoped>
.card.floating.public-links {
  width: min(960px, 94vw);
  max-width: 960px;
  max-height: 90vh;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 24px 80px #0006;
}
.public-links .card-title {
  align-items: center;
  gap: 16px;
  padding: 24px 24px 12px;
}
.card-title span {
  font-size: 13px;
  opacity: 0.65;
  white-space: nowrap;
}
.public-links h2 {
  font-size: 22px;
  font-weight: 600;
}
.public-links .card-content {
  padding: 0 24px 20px;
}
.card-content > p:first-child {
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.7;
}
.card-content > label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 12px;
  font-size: 13px;
}
.table-scroll {
  overflow: auto;
  max-height: 48vh;
  border: 1px solid var(--borderPrimary);
  border-radius: 8px;
}
.public-links table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin: 0;
}
.public-links th,
.public-links td {
  padding: 13px 12px;
  text-align: left;
  border-bottom: 1px solid var(--borderPrimary);
  font-size: 13px;
}
.public-links th {
  position: sticky;
  top: 0;
  background: var(--surfacePrimary);
  z-index: 1;
}
.public-links td:first-child {
  text-align: center;
}
.public-links tr:last-child td {
  border-bottom: 0;
}
.public-links td a,
.public-links td > span {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.public-links input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin: 0;
}
.notice {
  padding: 12px 14px;
  border-radius: 8px;
  margin-top: 16px;
  font-size: 13px;
  line-height: 1.5;
}
.notice.success {
  background: #22c55e18;
  color: #16a34a;
}
.notice.error {
  background: #ef444418;
  color: #ef4444;
}
.notice.progress {
  background: #80808015;
}
.public-links .card-action {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px 24px;
  border-top: 1px solid var(--borderPrimary);
}
.public-links .button {
  margin: 0;
  border-radius: 6px;
  font-size: 13px;
}
@media (max-width: 600px) {
  .public-links .card-title {
    padding: 18px 16px 12px;
  }
  .public-links .card-content {
    padding: 0 16px 16px;
  }
  .public-links .card-action {
    padding: 12px 16px;
  }
  .public-links th,
  .public-links td {
    padding: 12px 8px;
  }
}
</style>
