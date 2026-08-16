export const VESSELS = Object.freeze(["ORCA", "JADE", "SUN"]);
export const WEIGHT_LABELS = Object.freeze({ 1: "輕", 2: "中", 3: "重" });
export const MAX_STACK = 4;
export const WORK_POINTS = 3;
export const RESHUFFLE_COST = 12;
export const LATE_PENALTY = 45;
export const WRONG_VESSEL_PENALTY = 80;
export const CONTRACT_REWARD = 100;

function hash(seed, value) {
  let n = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
  n ^= n >>> 16;
  n = Math.imul(n, 0x21f0aaad);
  n ^= n >>> 15;
  return n >>> 0;
}

export function createContainer({
  id,
  vessel,
  weight,
  deadline,
  hazmat = false,
  crane = 0,
}) {
  return { id, vessel, weight, deadline, hazmat, crane };
}

function arrivalsFor(seed, round) {
  return [0, 1].map((crane) => {
    const n = hash(seed, round * 7 + crane);
    const vesselIndex = (round + crane + (n % 2)) % VESSELS.length;
    return createContainer({
      id: `R${round}-${crane + 1}`,
      vessel: VESSELS[vesselIndex],
      weight: 1 + ((n >>> 3) % 3),
      deadline: Math.min(10, round + 2 + ((n >>> 7) % 2)),
      hazmat: (round === 3 && crane === 1) || (round === 7 && crane === 0),
      crane,
    });
  });
}

function withScore(game) {
  game.score =
    game.contractScore -
    game.reshuffleCost -
    game.latePenalty -
    game.wrongVesselPenalty;
  return game;
}

function cloneGame(game) {
  return {
    ...game,
    yard: game.yard.map((stack) => stack.map((box) => ({ ...box }))),
    quay: game.quay.map((lane) => lane.map((box) => ({ ...box }))),
    temp: game.temp.map((box) => ({ ...box })),
    delivered: game.delivered.map((box) => ({ ...box })),
    lateCharged: [...game.lateCharged],
    log: [...game.log],
  };
}

export function createGame({ seed = Date.now(), prezone = "none" } = {}) {
  const safeSeed = Number(seed) >>> 0;
  const first = arrivalsFor(safeSeed, 1);
  return withScore({
    seed: safeSeed,
    round: 1,
    maxRounds: 10,
    phase: "playing",
    currentVessel: VESSELS[0],
    yard: Array.from({ length: 6 }, () => []),
    quay: [[first[0]], [first[1]]],
    temp: [],
    prezone,
    workPoints: WORK_POINTS,
    contractScore: 0,
    reshuffleCost: 0,
    latePenalty: 0,
    wrongVesselPenalty: 0,
    score: 0,
    delivered: [],
    lateCharged: [],
    message: "兩座橋式起重機已收到首批貨櫃。",
    loseReason: "",
    log: [],
  });
}

function neighborHasHazmat(yard, slotIndex) {
  return [slotIndex - 1, slotIndex + 1].some(
    (index) => index >= 0 && index < yard.length && yard[index].some((box) => box.hazmat),
  );
}

export function canPlace(stack, container, slotIndex, yard) {
  if (!stack || stack.length >= MAX_STACK) return false;
  if (stack.some((box) => box.hazmat)) return false;
  if (neighborHasHazmat(yard, slotIndex)) return false;
  if (container.hazmat) {
    if (stack.length > 0) return false;
    const neighbors = [yard[slotIndex - 1], yard[slotIndex + 1]].filter(Boolean);
    if (neighbors.some((neighbor) => neighbor.length > 0)) return false;
  }
  const top = stack.at(-1);
  return !top || top.weight >= container.weight;
}

export function zoneForSlot(slotIndex) {
  return VESSELS[Math.floor(slotIndex / 2)];
}

function allowedByZone(game, container, slotIndex) {
  return game.prezone !== "zoned" || zoneForSlot(slotIndex) === container.vessel;
}

export function legalSlots(game, container) {
  return game.yard
    .map((stack, index) =>
      canPlace(stack, container, index, game.yard) &&
      allowedByZone(game, container, index)
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
}

function reject(game, message) {
  const next = cloneGame(game);
  next.message = message;
  return next;
}

function spend(next) {
  next.workPoints -= 1;
}

function record(next, text) {
  next.message = text;
  next.log = [text, ...next.log].slice(0, 5);
  return withScore(next);
}

export function applyAction(game, action) {
  if (game.phase !== "playing") return reject(game, "本局已結束。");
  if (game.workPoints <= 0) return reject(game, "本輪 3 點設備工點已用完。");
  const next = cloneGame(game);

  if (action.type === "unload") {
    const lane = next.quay[action.crane];
    const container = lane?.[0];
    if (!container) return reject(game, "這座橋式起重機沒有待卸貨櫃。");
    const slots = legalSlots(next, container);
    if (slots.length === 0) {
      next.phase = "lost";
      next.loseReason = "沒有合法空位：碼頭壅塞，合約立即終止。";
      return record(next, next.loseReason);
    }
    if (!slots.includes(action.to)) {
      return reject(
        game,
        allowedByZone(game, container, action.to)
          ? "該格違反重量或危險品隔離規則。"
          : "該格不屬於此船的預先分區。",
      );
    }
    lane.shift();
    next.yard[action.to].push(container);
    spend(next);
    return record(next, `${container.id} 已卸至堆場 ${action.to + 1}。`);
  }

  if (action.type === "move") {
    const stack = next.yard[action.from];
    const container = stack?.at(-1);
    if (!container || (action.containerId && action.containerId !== container.id)) {
      return reject(game, "只能吊運堆疊最上層的貨櫃。");
    }
    if (action.to === "temp") {
      if (next.temp.length >= 2) return reject(game, "臨時區最多只能放 2 櫃。");
      stack.pop();
      next.temp.push(container);
    } else {
      if (
        !canPlace(next.yard[action.to], container, action.to, next.yard) ||
        !allowedByZone(next, container, action.to)
      ) {
        return reject(game, "目的格違反重量、危險品隔離或預先分區規則。");
      }
      stack.pop();
      next.yard[action.to].push(container);
    }
    spend(next);
    next.reshuffleCost += RESHUFFLE_COST;
    return record(next, `場橋重排 ${container.id}，成本 −${RESHUFFLE_COST}。`);
  }

  if (action.type === "tempToYard") {
    const index = next.temp.findIndex((box) => box.id === action.containerId);
    const container = next.temp[index];
    if (!container) return reject(game, "臨時區找不到該貨櫃。");
    if (
      !canPlace(next.yard[action.to], container, action.to, next.yard) ||
      !allowedByZone(next, container, action.to)
    ) {
      return reject(game, "目的格違反重量、危險品隔離或預先分區規則。");
    }
    next.temp.splice(index, 1);
    next.yard[action.to].push(container);
    spend(next);
    next.reshuffleCost += RESHUFFLE_COST;
    return record(next, `${container.id} 從臨時區返回堆場，成本 −${RESHUFFLE_COST}。`);
  }

  if (action.type === "load") {
    const stack = next.yard[action.from];
    const container = stack?.at(-1);
    if (!container) return reject(game, "這個堆位沒有可裝船的貨櫃。");
    stack.pop();
    spend(next);
    const correct = container.vessel === next.currentVessel;
    const onTime = next.round <= container.deadline;
    if (correct && onTime) next.contractScore += CONTRACT_REWARD;
    else if (correct) next.contractScore += 35;
    else next.wrongVesselPenalty += WRONG_VESSEL_PENALTY;
    next.delivered.push({ ...container, loadedRound: next.round, correct, onTime });
    return record(
      next,
      correct
        ? `${container.id} 裝上 ${next.currentVessel}，${onTime ? `合約 +${CONTRACT_REWARD}` : "逾期只得 +35"}。`
        : `${container.id} 裝錯船！重罰 −${WRONG_VESSEL_PENALTY}。`,
    );
  }

  return reject(game, "未知的設備指令。");
}

function allPending(game) {
  return [...game.yard.flat(), ...game.quay.flat(), ...game.temp];
}

export function endRound(game, { addArrivals = true } = {}) {
  if (game.phase !== "playing") return cloneGame(game);
  const next = cloneGame(game);
  const newlyLate = allPending(next).filter(
    (box) => box.deadline <= next.round && !next.lateCharged.includes(box.id),
  );
  next.latePenalty += newlyLate.length * LATE_PENALTY;
  next.lateCharged.push(...newlyLate.map((box) => box.id));

  if (next.round >= next.maxRounds) {
    next.phase = "ended";
    next.message = "十輪作業結束，港務處正在結算。";
    return withScore(next);
  }

  next.round += 1;
  next.currentVessel = VESSELS[(next.round - 1) % VESSELS.length];
  next.workPoints = WORK_POINTS;
  if (addArrivals) {
    for (const container of arrivalsFor(next.seed, next.round)) {
      next.quay[container.crane].push(container);
    }
  }
  const lateText = newlyLate.length ? ` ${newlyLate.length} 櫃逾期，罰 ${newlyLate.length * LATE_PENALTY}。` : "";
  next.message = `第 ${next.round} 輪：${next.currentVessel} 靠港。${lateText}`;
  return withScore(next);
}
