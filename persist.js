const BEST_URL = "/api/kv/pierbox:best";
const UNLOCKS_URL = "/api/kv/pierbox:unlocks";

export async function loadProgress(fetcher = fetch) {
  try {
    const [bestResponse, unlocksResponse] = await Promise.all([
      fetcher(BEST_URL),
      fetcher(UNLOCKS_URL),
    ]);
    const bestValue = bestResponse.ok ? Number(await bestResponse.text()) : 0;
    const parsed = unlocksResponse.ok ? JSON.parse(await unlocksResponse.text()) : [];
    return {
      best: Number.isFinite(bestValue) ? Math.max(0, bestValue) : 0,
      unlocks: Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [],
    };
  } catch {
    return { best: 0, unlocks: [] };
  }
}

export async function saveBest(score, currentBest, fetcher = fetch) {
  const nextBest = Math.max(score, currentBest);
  if (nextBest <= currentBest) return currentBest;
  try {
    await fetcher(BEST_URL, { method: "PUT", body: String(nextBest) });
  } catch {
    // Static previews stay fully playable without the Playgrounds KV API.
  }
  return nextBest;
}

export async function saveUnlocks(unlocks, fetcher = fetch) {
  const unique = [...new Set(unlocks)];
  try {
    await fetcher(UNLOCKS_URL, {
      method: "PUT",
      body: JSON.stringify(unique),
    });
  } catch {
    // Unlocks are optional progress, so offline play continues.
  }
  return unique;
}
