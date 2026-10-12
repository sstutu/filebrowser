import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUploadStore } from "../upload";

const harness = vi.hoisted(() => ({
  post: vi.fn(),
  error: vi.fn(),
  links: { recent: [] as { name: string; url: string }[], open: vi.fn() },
  user: { perm: { share: true, download: true } },
}));
vi.mock("@/api", () => ({ files: { post: harness.post } }));
vi.mock("@/api/tus", () => ({ abortAllUploads: vi.fn() }));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: harness.user }),
}));
vi.mock("@/stores/public-links", () => ({
  usePublicLinksStore: () => harness.links,
}));
vi.mock("@/utils/buttons", () => ({
  default: { loading: vi.fn(), success: vi.fn() },
}));
vi.mock("vue", async (original) => ({
  ...(await original<typeof import("vue")>()),
  inject: () => harness.error,
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  harness.links.recent = [];
  harness.user.perm.download = true;
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: vi.fn(() => 1),
  });
});

describe("uploaded public link results", () => {
  it("opens once with successful files, excluding directories and failures", async () => {
    harness.post
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Upload aborted"));
    const store = useUploadStore();
    const file = { size: 1 } as File;
    store.upload("/files/folder/", "folder", null, false, "dir");
    store.upload("/files/folder/good.png", "good.png", file, false, "image");
    store.upload("/files/bad.png", "bad.png", file, false, "image");
    await vi.waitFor(() => expect(harness.links.open).toHaveBeenCalledOnce());
    expect(harness.links.recent).toEqual([
      { name: "good.png", url: "/files/folder/good.png" },
    ]);
    expect(harness.links.open).toHaveBeenCalledWith(harness.links.recent);
    expect(harness.error).not.toHaveBeenCalled();
  });

  it("requires download permission before opening public link controls", async () => {
    harness.user.perm.download = false;
    harness.post.mockResolvedValue(undefined);
    useUploadStore().upload(
      "/files/one",
      "one",
      { size: 1 } as File,
      false,
      "blob"
    );
    await vi.waitFor(() => expect(harness.links.recent).toHaveLength(1));
    expect(harness.links.open).not.toHaveBeenCalled();
  });
});
