import { defineStore } from "pinia";
import { ref } from "vue";
import { share, files as fileApi } from "@/api";
import { createURL } from "@/api/utils";
import { useLayoutStore } from "./layout";
import { copyPreparedPublicLinks, publicLinksTSV } from "@/utils/public-links";
import { encodePath } from "@/utils/url";

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
  async function expandFolders(files: PublicLinkFile[]) {
    const roots: PublicLinkFile[] = [];
    for (const folder of files
      .filter((file) => file.isDir)
      .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))) {
      const url = folder.url.replace(/\/?$/, "/");
      if (!roots.length || !url.startsWith(roots[roots.length - 1].url))
        roots.push({ ...folder, url });
    }
    const result = new Map<string, PublicLinkFile>();
    for (const file of files.filter((file) => !file.isDir))
      result.set(file.url, file);
    // One recursive listing per selected root; no per-file metadata requests.
    for (const root of roots) {
      const entries = await fileApi.fetchAll(root.url);
      for (const entry of entries) {
        if (entry.isDir) continue;
        const url = `/files${encodePath(entry.path.startsWith("/") ? entry.path : `/${entry.path}`)}`;
        if (!url.startsWith(root.url))
          throw new Error("目录返回了范围外文件，已停止复制。");
        const relativePath = decodeURIComponent(url.slice(root.url.length));
        result.set(url, {
          name: `${root.name}/${relativePath}`,
          url,
          shareFolder: root.url,
          relativePath,
        });
      }
    }
    return [...result.values()];
  }
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
    let selected = [...rows.value];
    try {
      await copyPreparedPublicLinks(async () => {
        if (mode === "table" && files.some((file) => file.isDir)) {
          const expanded = await expandFolders(files);
          if (!expanded.length)
            throw new Error("所选文件夹内没有可复制的文件。");
          rows.value = expanded.map((file) => ({
            ...file,
            selected: true,
            link: "",
            error: "",
          }));
          selected = [...rows.value];
        }
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
              ) || (await share.create(folder));
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
