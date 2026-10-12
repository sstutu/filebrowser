import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { usePublicLinksStore } from "../public-links";
import { publicLinksTSV } from "../../utils/public-links";
import { useLayoutStore } from "../layout";

const api = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
const clipboard = vi.hoisted(() => vi.fn());
const fetchAll = vi.hoisted(() => vi.fn());
vi.mock("@/utils/clipboard", () => ({ copy: clipboard }));
vi.mock("@/api", () => ({ share: api, files: { fetchAll } }));
vi.mock("@/api/utils", () => ({
  createURL: (path: string) => `https://files.example/${path}?inline=true`,
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.stubGlobal("window", { isSecureContext: false });
  clipboard.mockResolvedValue(undefined);
});
describe("public link generation", () => {
  it("reuses a selected folder for mixed descendant file selections", async () => {
    api.get.mockResolvedValue([]);
    api.create.mockResolvedValue({ hash: "folder" });
    const store = usePublicLinksStore();
    await store.copyFiles(
      [
        { name: "images", url: "/files/images/", isDir: true },
        { name: "a.png", url: "/files/images/nested/a.png" },
      ],
      "links"
    );
    expect(api.create.mock.calls.map((args) => args.slice(0, 1))).toEqual([
      ["/files/images/"],
    ]);
    expect(store.rows[1].link).toContain("/folder/nested/a.png");
    expect(fetchAll).not.toHaveBeenCalled();
  });
  it("copies a selected folder's public entry without scanning its files", async () => {
    api.get.mockResolvedValue([]);
    api.create.mockResolvedValue({ hash: "folder" });
    const store = usePublicLinksStore();
    await store.copyFiles(
      [{ name: "images", url: "/files/images/", isDir: true }],
      "links"
    );
    expect(api.create).toHaveBeenCalledWith(
      "/files/images/",
      "",
      "",
      "hours",
      true
    );
    expect(fetchAll).not.toHaveBeenCalled();
    expect(clipboard).toHaveBeenCalledWith({
      text: "https://files.example/share/folder?inline=true",
    });
  });
  it("exports only the selected folder name and public entry, including empty folders", async () => {
    api.get.mockResolvedValue([]);
    api.create.mockResolvedValue({ hash: "folder" });
    const store = usePublicLinksStore();
    const count = await store.copyFiles(
      [{ name: "printPic", url: "/files/printPic/", isDir: true }],
      "table"
    );
    expect(count).toBe(1);
    expect(fetchAll).not.toHaveBeenCalled();
    expect(clipboard).toHaveBeenCalledWith({
      text: "printPic\thttps://files.example/share/folder?inline=true",
    });
  });
  it("bounds concurrent share lookups across many directories", async () => {
    let active = 0;
    let maximum = 0;
    api.get.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return [{ hash: "existing", hasPassword: false, expire: 0 }];
    });
    const store = usePublicLinksStore();
    store.open(
      Array.from({ length: 12 }, (_, i) => ({
        name: "a.png",
        url: `/files/${i}/a.png`,
      }))
    );
    await store.generate();
    expect(maximum).toBeLessThanOrEqual(4);
    expect(maximum).toBeGreaterThan(1);
    expect(api.get).toHaveBeenCalledTimes(12);
    expect(api.create).not.toHaveBeenCalled();
  });
  it("creates one folder share for 100 files and reuses it on the next copy", async () => {
    api.get
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { hash: "folder", expire: 0, hasPassword: false },
      ]);
    api.create.mockResolvedValue({ hash: "folder" });
    const store = usePublicLinksStore();
    const files = Array.from({ length: 100 }, (_, index) => ({
      name: `${index}.png`,
      url: `/files/images/${index}.png`,
    }));
    await store.copyFiles(files, "links");
    await store.copyFiles(files, "table");
    expect(api.get.mock.calls).toEqual([
      ["/files/images/"],
      ["/files/images/"],
    ]);
    expect(api.create.mock.calls.map((args) => args.slice(0, 1))).toEqual([
      ["/files/images/"],
    ]);
    expect(store.rows[99].link).toContain("/folder/99.png");
  });
  it("shares the containing root and decodes file names exactly once", async () => {
    api.get.mockResolvedValue([]);
    api.create.mockResolvedValue({ hash: "root" });
    const store = usePublicLinksStore();
    store.open([
      { name: "中文 #%.png", url: "/files/%E4%B8%AD%E6%96%87%20%23%25.png" },
    ]);
    await store.generate();
    expect(api.create).toHaveBeenCalledWith("/files/", "", "", "hours", true);
    expect(store.rows[0].link).toContain("/root/中文 #%.png");
  });
  it("copies right-click selections directly without opening a modal", async () => {
    api.get.mockResolvedValue([]);
    api.create.mockResolvedValue({ hash: "public" });
    const store = usePublicLinksStore();
    const count = await store.copyFiles(
      [{ name: "one.png", url: "/files/one.png" }],
      "table"
    );
    expect(count).toBe(1);
    expect(useLayoutStore().prompts).toHaveLength(0);
    expect(clipboard).toHaveBeenCalledWith({
      text: "one.png\thttps://files.example/api/public/dl/public/one.png?inline=true",
    });
    expect(store.copying).toBe(false);
  });
  it("does not copy partial results when right-click generation fails", async () => {
    api.get.mockRejectedValue(new Error("403 Forbidden"));
    const store = usePublicLinksStore();
    await expect(
      store.copyFiles([{ name: "one.png", url: "/files/one.png" }], "links")
    ).rejects.toThrow("部分链接生成失败");
    expect(clipboard).not.toHaveBeenCalled();
    expect(store.copying).toBe(false);
  });
  it("reuses only explicitly unprotected permanent shares", async () => {
    api.get.mockResolvedValue([
      { hash: "private", expire: 0, hasPassword: true },
      { hash: "temporary", expire: 9999999999, hasPassword: false },
      { hash: "unknown", expire: 0 },
      { hash: "public", expire: 0, hasPassword: false },
    ]);
    const store = usePublicLinksStore();
    store.open([{ name: "image.png", url: "/files/image.png" }]);
    await store.generate();
    expect(api.create).not.toHaveBeenCalled();
    expect(store.rows[0].link).toContain("/public/image.png?inline=true");
  });
  it("generates only checked files and preserves successes when another fails", async () => {
    api.get.mockResolvedValue([]);
    api.create
      .mockResolvedValueOnce({ hash: "new" })
      .mockRejectedValueOnce(new Error("403 Forbidden"));
    const store = usePublicLinksStore();
    store.open(
      ["one", "two", "three"].map((name) => ({
        name,
        url: `/files/${name}/${name}`,
      }))
    );
    store.rows[2].selected = false;
    await store.generate();
    expect(api.create.mock.calls.map((args) => args.slice(0, 1))).toEqual([
      ["/files/one/"],
      ["/files/two/"],
    ]);
    expect(store.rows[0].link).toContain("/new/one");
    expect(store.rows[1].error).toBe("403 Forbidden");
    expect(store.rows[1].link).toBe("");
  });
  it("revalidates revoked links before creating replacements", async () => {
    api.get
      .mockResolvedValueOnce([{ hash: "old", expire: 0, hasPassword: false }])
      .mockResolvedValueOnce([]);
    api.create.mockResolvedValue({ hash: "replacement" });
    const store = usePublicLinksStore();
    store.open([{ name: "one", url: "/files/one" }]);
    await store.generate();
    await store.generate();
    expect(store.rows[0].link).toContain("/replacement/one");
  });
});
describe("spreadsheet export", () => {
  it("preserves cell boundaries and neutralizes formula-like names", () => {
    expect(
      publicLinksTSV([
        { name: 'a\t"b\n.png', link: "https://files.example/1" },
        { name: " =1+1", link: "https://files.example/2" },
      ])
    ).toBe(
      '"a\t""b\n.png"\thttps://files.example/1\r\n\' =1+1\thttps://files.example/2'
    );
  });
});
