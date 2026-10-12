import { beforeEach, describe, expect, it, vi } from "vitest";
import PublicLinks from "../PublicLinks.vue";

const harness = vi.hoisted(() => ({
  store: {
    rows: [
      {
        name: "one.png",
        url: "/files/one.png",
        selected: true,
        link: "",
        error: "",
        isDir: false,
      },
    ],
    busy: false,
    generate: vi.fn(),
    copyFiles: vi.fn(),
  },
  copy: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/stores/public-links", () => ({
  usePublicLinksStore: () => harness.store,
}));
vi.mock("@/stores/layout", () => ({
  useLayoutStore: () => ({ closeHovers: vi.fn() }),
}));
vi.mock("@/utils/clipboard", () => ({ copy: harness.copy }));
vi.mock("vue", async (original) => ({
  ...(await original<typeof import("vue")>()),
  inject: () => harness.success,
  useSSRContext: () => ({ modules: new Set<string>() }),
}));
beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  harness.store.rows[0].link = "";
  harness.store.rows[0].error = "";
  harness.store.rows[0].isDir = false;
  vi.stubGlobal("window", { isSecureContext: false });
  harness.copy.mockResolvedValue(undefined);
  harness.store.generate.mockImplementation(async () => {
    harness.store.rows[0].link = "https://files.example/one.png";
  });
});
const setup = () => (PublicLinks as any).setup({}, { expose: vi.fn() });
describe("one-click public file copying", () => {
  it("exports selected folders from the modal through the same direct copy flow", async () => {
    harness.store.rows[0].isDir = true;
    harness.store.copyFiles.mockResolvedValue(1);
    const modal = setup();
    await modal.copySelected("table");
    expect(harness.store.copyFiles).toHaveBeenCalledWith(
      harness.store.rows,
      "table"
    );
    expect(modal.message.value).toContain("已复制 1 个文件");
    expect(harness.store.generate).not.toHaveBeenCalled();
  });
  it("requests clipboard access before asynchronous link generation finishes", async () => {
    let finish!: () => void;
    harness.store.generate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            harness.store.rows[0].link = "https://files.example/one.png";
            resolve();
          };
        })
    );
    class Item {
      constructor(public data: Record<string, Promise<Blob>>) {}
    }
    const write = vi.fn(async (items: Item[]) => {
      const blob = await items[0].data["text/plain"];
      expect(await blob.text()).toBe("https://files.example/one.png");
    });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const modal = setup();
    const pending = modal.copySelected("links");
    expect(write).toHaveBeenCalledOnce();
    expect(modal.copying.value).toBe(true);
    finish();
    await pending;
    expect(modal.messageType.value).toBe("success");
  });
  it("generates and copies links with visible success feedback", async () => {
    const modal = setup();
    await modal.copySelected("links");
    expect(harness.copy).toHaveBeenCalledWith({
      text: "https://files.example/one.png",
    });
    expect(modal.copiedMode.value).toBe("links");
    expect(modal.message.value).toContain("已复制 1 个公网链接");
    expect(harness.success).toHaveBeenCalledOnce();
  });
  it("exports names and links as a spreadsheet in one click", async () => {
    const modal = setup();
    await modal.copySelected("table");
    expect(harness.copy).toHaveBeenCalledWith({
      text: "one.png\thttps://files.example/one.png",
    });
    expect(modal.messageType.value).toBe("success");
  });
  it("does not copy incomplete results or report false success", async () => {
    harness.store.generate.mockResolvedValue(undefined);
    const modal = setup();
    await modal.copySelected("table");
    expect(harness.copy).not.toHaveBeenCalled();
    expect(harness.success).not.toHaveBeenCalled();
    expect(modal.messageType.value).toBe("error");
    expect(modal.copying.value).toBe(false);
  });
});
