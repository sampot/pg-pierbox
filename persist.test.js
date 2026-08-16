import { describe, expect, it, vi } from "vitest";
import { loadProgress, saveBest, saveUnlocks } from "./persist.js";

describe("Pierbox persistence", () => {
  it("loads best and unlocks from their Playgrounds KV keys", async () => {
    const fetcher = vi.fn(async (url) => ({
      ok: true,
      text: async () => (url.endsWith(":best") ? "640" : '["night","storm"]'),
    }));
    await expect(loadProgress(fetcher)).resolves.toEqual({
      best: 640,
      unlocks: ["night", "storm"],
    });
    expect(fetcher).toHaveBeenCalledWith("/api/kv/pierbox:best");
    expect(fetcher).toHaveBeenCalledWith("/api/kv/pierbox:unlocks");
  });

  it("writes only a higher best and saves unique unlocks", async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    await expect(saveBest(90, 100, fetcher)).resolves.toBe(100);
    await expect(saveBest(120, 100, fetcher)).resolves.toBe(120);
    await saveUnlocks(["storm", "storm", "night"], fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/kv/pierbox:best", {
      method: "PUT",
      body: "120",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/kv/pierbox:unlocks", {
      method: "PUT",
      body: '["storm","night"]',
    });
  });

  it("degrades safely when the host KV API is unavailable", async () => {
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(loadProgress(offline)).resolves.toEqual({ best: 0, unlocks: [] });
    await expect(saveBest(22, 0, offline)).resolves.toBe(22);
  });
});
