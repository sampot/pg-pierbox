import { describe, expect, it } from "vitest";
import {
  applyAction,
  canPlace,
  createContainer,
  createGame,
  endRound,
  legalSlots,
} from "./game.js";

const box = (id, options = {}) =>
  createContainer({ id, vessel: "ORCA", weight: 2, deadline: 3, ...options });

describe("Pierbox yard rules", () => {
  it("creates a ten-round 6×4 yard with three work points", () => {
    const game = createGame({ seed: 42 });
    expect(game.round).toBe(1);
    expect(game.maxRounds).toBe(10);
    expect(game.yard).toHaveLength(6);
    expect(game.yard.every((stack) => stack.length === 0)).toBe(true);
    expect(game.workPoints).toBe(3);
  });

  it("only moves the top container from a stack", () => {
    const game = createGame({ seed: 1 });
    game.yard[0] = [box("bottom", { weight: 3 }), box("top", { weight: 1 })];
    const next = applyAction(game, { type: "move", from: 0, containerId: "bottom", to: 2 });
    expect(next.message).toMatch(/最上層/);
    expect(next.yard[0]).toHaveLength(2);
    expect(next.workPoints).toBe(3);
  });

  it("keeps heavy boxes below lighter boxes", () => {
    expect(canPlace([box("light", { weight: 1 })], box("heavy", { weight: 3 }), 1, [[], []])).toBe(false);
    expect(canPlace([box("heavy", { weight: 3 })], box("light", { weight: 1 }), 1, [[], []])).toBe(true);
  });

  it("isolates hazmat stacks from neighboring cargo", () => {
    const yard = [[], [box("regular")], [], [], [], []];
    expect(canPlace(yard[0], box("haz", { hazmat: true }), 0, yard)).toBe(false);
    expect(canPlace(yard[3], box("haz", { hazmat: true }), 3, yard)).toBe(true);
    yard[3] = [box("haz", { hazmat: true })];
    expect(canPlace(yard[2], box("new"), 2, yard)).toBe(false);
  });

  it("caps every yard stack at four containers", () => {
    const full = [3, 3, 2, 1].map((weight, index) => box(`b${index}`, { weight }));
    expect(canPlace(full, box("extra", { weight: 1 }), 0, [full])).toBe(false);
  });

  it("pre-zoning reserves two stacks per vessel", () => {
    const game = createGame({ seed: 5, prezone: "zoned" });
    const orca = box("orca", { vessel: "ORCA" });
    expect(legalSlots(game, orca)).toEqual([0, 1]);
    game.quay[0] = [orca];
    const rejected = applyAction(game, { type: "unload", crane: 0, to: 2 });
    expect(rejected.workPoints).toBe(3);
    expect(rejected.message).toMatch(/分區/);
  });

  it("spends one of three work points for each legal action", () => {
    const game = createGame({ seed: 4 });
    game.quay[0] = [box("q1")];
    const moved = applyAction(game, { type: "unload", crane: 0, to: 2 });
    expect(moved.workPoints).toBe(2);
    const stored = applyAction(moved, { type: "move", from: 2, to: "temp" });
    expect(stored.workPoints).toBe(1);
    const returned = applyAction(stored, { type: "tempToYard", containerId: "q1", to: 2 });
    expect(returned.workPoints).toBe(0);
    expect(applyAction(returned, { type: "move", from: 2, to: 3 }).message).toMatch(/工點/);
  });

  it("charges reshuffle cost without counting unloading", () => {
    const game = createGame({ seed: 7 });
    game.quay[0] = [box("q1")];
    const unloaded = applyAction(game, { type: "unload", crane: 0, to: 2 });
    expect(unloaded.reshuffleCost).toBe(0);
    const reshuffled = applyAction(unloaded, { type: "move", from: 2, to: 3 });
    expect(reshuffled.reshuffleCost).toBe(12);
    expect(reshuffled.score).toBe(-12);
  });

  it("awards on-time loading and penalizes the wrong vessel", () => {
    const game = createGame({ seed: 2 });
    game.currentVessel = "ORCA";
    game.yard[0] = [box("right", { vessel: "ORCA", deadline: 1 })];
    const onTime = applyAction(game, { type: "load", from: 0 });
    expect(onTime.contractScore).toBe(100);
    expect(onTime.delivered).toHaveLength(1);

    const other = createGame({ seed: 2 });
    other.currentVessel = "ORCA";
    other.yard[0] = [box("wrong", { vessel: "JADE", deadline: 2 })];
    const wrong = applyAction(other, { type: "load", from: 0 });
    expect(wrong.wrongVesselPenalty).toBe(80);
    expect(wrong.score).toBeLessThan(0);
  });

  it("applies a heavy late penalty once per overdue container", () => {
    const game = createGame({ seed: 3 });
    game.yard[0] = [box("late", { deadline: 1 })];
    const round2 = endRound(game);
    expect(round2.latePenalty).toBe(45);
    const round3 = endRound(round2);
    expect(round3.latePenalty).toBe(45);
  });

  it("loses immediately when an unload has no legal yard slot", () => {
    const game = createGame({ seed: 8 });
    game.yard = Array.from({ length: 6 }, (_, slot) =>
      Array.from({ length: 4 }, (_, level) =>
        box(`${slot}-${level}`, { weight: 3 - Math.min(level, 2) }),
      ),
    );
    game.quay[0] = [box("blocked")];
    expect(legalSlots(game, game.quay[0][0])).toEqual([]);
    const lost = applyAction(game, { type: "unload", crane: 0, to: 0 });
    expect(lost.phase).toBe("lost");
    expect(lost.loseReason).toMatch(/沒有合法空位/);
  });

  it("finishes after round ten and computes score components", () => {
    let game = createGame({ seed: 12 });
    game.quay = [[], []];
    for (let round = 1; round <= 10; round += 1) game = endRound(game, { addArrivals: false });
    expect(game.phase).toBe("ended");
    expect(game.round).toBe(10);
    expect(game.score).toBe(
      game.contractScore - game.reshuffleCost - game.latePenalty - game.wrongVesselPenalty,
    );
  });
});
