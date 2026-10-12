import { defineStore } from "pinia";
import { ref } from "vue";
import { share } from "@/api";
import { createURL } from "@/api/utils";
import { useLayoutStore } from "./layout";
import { copyPreparedPublicLinks, publicLinksTSV } from "@/utils/public-links";

export interface PublicLinkFile {
  name: string;
  url: string;
  isDir?: boolean;
  shareFolder?: string;
  relativePath?: string;
}
export const usePublicLinksStore = defineStore("public-links", () => {
  const recent = ref<PublicLinkFile[]>([]);
  const rows = ref<
    (PublicLinkFile & { selected: boolean; link: string; error: string })[]
  >([]);
  const busy = ref(false);
  const copying = ref(false);
  function open(files: PublicLinkFile[], show = true) {
    if (busy.value || copying.value) return;
    const previous = new Map(rows.value.map((row) => [row.url, row]));
    rows.value = Array.from(
      new Map(files.map((file) => [file.url, file])).values()
    ).map((file) => ({
      ...file,
      selected: true,
      link: previous.get(file.url)?.link || "",
      error: "",
    }));
    if (show) useLayoutStore().showHover("public-links");
  }
  async function copyFiles(files: PublicLinkFile[], mode: "links" | "table") {
    if (busy.value || copying.value || !files.length) return 0;
    open(files, false);
    copying.value = true;
    const selected = [...rows.value];
    try {
      await copyPreparedPublicLinks(async () => {
        await generate();
        if (selected.some((row) => !row.link))
          throw new Error(
            "部分链接生成失败，请通过工具栏打开链接表格查看并重试。"
          );
        return mode === "table"
          ? publicLinksTSV(selected)
          : selected.map((row) => row.link).join("\n");
      });
      return selected.length;
    } finally {
      copying.value = false;
    }
  }
  async function generate() {
    if (busy.value) return;
    busy.value = true;
    try {
      const folders = new Map<string, typeof rows.value>();
      const selected = rows.value.filter((row) => row.selected);
      const selectedFolders = new Set(
        selected
          .filter((row) => row.isDir)
          .map((row) => row.url.replace(/\/?$/, "/"))
      );
      for (const row of selected) {
        let folder =
          row.shareFolder ||
          (row.isDir
            ? row.url.replace(/\/?$/, "/")
            : row.url.slice(0, row.url.lastIndexOf("/") + 1));
        if (!row.shareFolder) {
          let parent = folder;
          while (parent !== "/files/" && parent.length > "/files/".length) {
            parent = parent.slice(0, -1);
            parent = parent.slice(0, parent.lastIndexOf("/") + 1);
            if (selectedFolders.has(parent)) folder = parent;
          }
        }
        const files = folders.get(folder) || [];
        files.push(row);
        folders.set(folder, files);
      }
      const jobs = [...folders];
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const [folder, files] = jobs[next++];
          for (const row of files) row.error = "";
          try {
            const existing = await share.get(folder);
            const link =
              existing.find(
                (link) => link.hasPassword === false && link.expire === 0
              ) || (await share.create(folder, "", "", "hours", true));
            for (const row of files) {
              const name =
                row.relativePath ||
                decodeURIComponent(row.url.slice(folder.length));
              row.link = row.isDir
                ? createURL(`share/${link.hash}${name ? `/${name}` : ""}`)
                : createURL(`api/public/dl/${link.hash}/${name}`, {
                    inline: "true",
                  });
            }
          } catch (error) {
            for (const row of files) {
              row.link = "";
              row.error =
                error instanceof Error ? error.message : "生成失败，请重试";
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(4, jobs.length) }, worker)
      );
    } finally {
      busy.value = false;
    }
  }
  return { recent, rows, busy, copying, open, generate, copyFiles };
});
