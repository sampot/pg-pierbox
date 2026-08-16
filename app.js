import { HarborAudio } from "./audio.js";
import {
  VESSELS,
  WEIGHT_LABELS,
  applyAction,
  createGame,
  endRound,
  legalSlots,
  zoneForSlot,
} from "./game.js";
import { loadProgress, saveBest, saveUnlocks } from "./persist.js";

const $ = (selector) => document.querySelector(selector);
const audio = new HarborAudio();
const colors = {
  ORCA: ["#2cb9d3", "#3bd0e4", "#198ea8"],
  JADE: ["#40c684", "#5ddd9b", "#239b66"],
  SUN: ["#f09b39", "#ffc05a", "#d37825"],
};

let game = null;
let selected = null;
let best = 0;
let unlocks = [];

function colorFor(box) {
  return colors[box.vessel][box.weight - 1];
}

function boxMarkup(box, extra = "") {
  const late = game.lateCharged.includes(box.id) || box.deadline < game.round;
  return `
    <button class="container ${box.hazmat ? "hazmat" : ""} ${late ? "late" : ""} ${extra}"
      type="button" style="--box-color:${colorFor(box)}" aria-label="${box.id}，${box.vessel}，${WEIGHT_LABELS[box.weight]}櫃，期限第 ${box.deadline} 輪">
      <strong>${box.id} · ${box.vessel}</strong>
      <small>${WEIGHT_LABELS[box.weight]}櫃 · D${box.deadline}${box.hazmat ? " · HAZ" : ""}</small>
    </button>`;
}

function renderQuay() {
  $("#quay-lanes").innerHTML = game.quay
    .map(
      (lane, crane) => `
      <article class="quay-lane">
        <div class="crane-name">QC-${crane + 1}<br />橋吊</div>
        <div class="queue">
          ${
            lane.length
              ? lane
                  .map((box, index) => {
                    const active =
                      selected?.source === "quay" && selected.crane === crane && index === 0;
                    return boxMarkup(box, `${active ? "selected" : ""} ${index ? "queued" : ""}`)
                      .replace("<button ", `<button data-source="quay" data-crane="${crane}" data-queue="${index}" ${index ? "disabled" : ""} `);
                  })
                  .join("")
              : '<span class="selection-label">CLEAR</span>'
          }
        </div>
      </article>`,
    )
    .join("");
}

function selectedContainer() {
  if (!selected) return null;
  if (selected.source === "quay") return game.quay[selected.crane][0];
  if (selected.source === "yard") return game.yard[selected.slot].at(-1);
  return game.temp.find((box) => box.id === selected.id);
}

function renderYard() {
  const selectedBox = selectedContainer();
  const legal = selectedBox ? legalSlots(game, selectedBox) : [];
  $("#yard").innerHTML = game.yard
    .map((stack, slot) => {
      const isDestination = selectedBox && legal.includes(slot);
      const blocked = selectedBox && !legal.includes(slot);
      return `
        <div class="stack ${isDestination ? "legal" : ""} ${blocked ? "illegal" : ""}"
          data-slot="${slot}" data-label="BAY ${slot + 1}" role="button" tabindex="0"
          aria-label="堆位 ${slot + 1}，${stack.length} 櫃">
          ${game.prezone === "zoned" ? `<span class="zone-name">${zoneForSlot(slot)}</span>` : ""}
          ${stack
            .map((box, index) => {
              const isTop = index === stack.length - 1;
              const active = selected?.source === "yard" && selected.slot === slot && isTop;
              return boxMarkup(box, active ? "selected" : "").replace(
                "<button ",
                `<button data-source="yard" data-slot="${slot}" ${isTop ? "" : "tabindex=\"-1\""} `,
              );
            })
            .join("")}
        </div>`;
    })
    .join("");
}

function renderTemp() {
  $("#temp-area").innerHTML = game.temp
    .map((box) =>
      boxMarkup(box, selected?.source === "temp" && selected.id === box.id ? "selected" : "").replace(
        "<button ",
        `<button data-source="temp" data-id="${box.id}" `,
      ),
    )
    .join("");
}

function renderHud() {
  $("#round-value").textContent = `${game.round} / ${game.maxRounds}`;
  $("#vessel-value").textContent = game.currentVessel;
  $("#current-vessel").textContent = game.currentVessel;
  $("#work-value").textContent = `${"●".repeat(game.workPoints)}${"○".repeat(3 - game.workPoints)}`;
  $("#score-value").textContent = String(game.score);
  $("#contract-score").textContent = `+${game.contractScore}`;
  $("#reshuffle-score").textContent = `−${game.reshuffleCost}`;
  $("#penalty-score").textContent = `−${game.latePenalty + game.wrongVesselPenalty}`;
  $("#message").textContent = game.message;

  const box = selectedContainer();
  $("#selection-label").textContent = box
    ? `${box.id} / ${box.vessel} / D${box.deadline}`
    : "選擇一個貨櫃";
  $("#load-button").disabled = selected?.source !== "yard" || game.workPoints <= 0;
  $("#temp-button").disabled =
    selected?.source !== "yard" || game.temp.length >= 2 || game.workPoints <= 0;
  $("#end-button").disabled = game.phase !== "playing";
}

function render() {
  renderHud();
  renderQuay();
  renderYard();
  renderTemp();
}

function choose(source) {
  selected = source;
  audio.play("click");
  render();
}

function dispatch(action) {
  const beforePoints = game.workPoints;
  const beforePhase = game.phase;
  game = applyAction(game, action);
  if (game.workPoints < beforePoints || game.phase !== beforePhase) selected = null;
  audio.play(game.phase === "lost" || game.message.includes("重罰") ? "alarm" : "click");
  render();
  if (game.phase === "lost") showFinal();
}

function sendToSlot(slot) {
  if (!selected) return;
  if (selected.source === "quay") {
    dispatch({ type: "unload", crane: selected.crane, to: slot });
  } else if (selected.source === "yard") {
    if (selected.slot === slot) {
      selected = null;
      render();
    } else {
      dispatch({ type: "move", from: selected.slot, to: slot });
    }
  } else {
    dispatch({ type: "tempToYard", containerId: selected.id, to: slot });
  }
}

$("#quay-lanes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-source='quay']");
  if (!button || button.disabled) return;
  choose({ source: "quay", crane: Number(button.dataset.crane) });
});

$("#yard").addEventListener("click", (event) => {
  const stack = event.target.closest(".stack");
  if (!stack) return;
  const slot = Number(stack.dataset.slot);
  if (selected) {
    sendToSlot(slot);
    return;
  }
  if (game.yard[slot].length) choose({ source: "yard", slot });
});

$("#yard").addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".stack")) {
    event.preventDefault();
    event.target.click();
  }
});

$("#temp-area").addEventListener("click", (event) => {
  const button = event.target.closest("[data-source='temp']");
  if (button) choose({ source: "temp", id: button.dataset.id });
});

$("#load-button").addEventListener("click", () => {
  if (selected?.source === "yard") dispatch({ type: "load", from: selected.slot });
  if (game?.delivered.at(-1)?.correct) audio.play("contract");
});

$("#temp-button").addEventListener("click", () => {
  if (selected?.source === "yard") dispatch({ type: "move", from: selected.slot, to: "temp" });
});

function unlockForScore() {
  const next = [...unlocks];
  if (game.contractScore >= 100 && !next.includes("night")) next.push("night");
  if (game.score >= 500 && !next.includes("storm")) next.push("storm");
  if (next.length !== unlocks.length) {
    unlocks = next;
    void saveUnlocks(unlocks);
  }
}

function showFinal() {
  const lost = game.phase === "lost";
  unlockForScore();
  if (!lost) {
    void saveBest(game.score, best).then((value) => {
      best = value;
      $("#best-score").textContent = String(best);
    });
  }
  $("#sheet-kicker").textContent = lost ? "EMERGENCY STOP" : "SHIFT COMPLETE";
  $("#sheet-title").textContent = lost ? "堆場鎖死，班次中止" : game.score >= 500 ? "港口調度王牌！" : "十輪班表完成";
  $("#sheet-content").innerHTML = `
    <p>${lost ? game.loseReason : "每一分都來自準時合約；重排、逾期與錯船已從中扣除。"}</p>
    <div class="result-grid">
      <div><span>合約收入</span><strong>+${game.contractScore}</strong></div>
      <div><span>重排成本</span><strong>−${game.reshuffleCost}</strong></div>
      <div><span>逾期／錯船</span><strong>−${game.latePenalty + game.wrongVesselPenalty}</strong></div>
      <div><span>最終分數</span><strong>${game.score}</strong></div>
    </div>`;
  $("#sheet-button").textContent = "重新排班";
  $("#sheet").hidden = false;
  $("#sheet-button").focus();
  audio.play(lost ? "alarm" : "contract");
}

$("#end-button").addEventListener("click", () => {
  const previousPenalty = game.latePenalty;
  game = endRound(game);
  selected = null;
  audio.play(game.latePenalty > previousPenalty ? "alarm" : "click");
  render();
  if (game.phase === "ended") showFinal();
});

document.querySelectorAll("input[name='strategy']").forEach((input) => {
  input.addEventListener("change", () => {
    document.querySelectorAll(".strategy").forEach((label) => {
      label.classList.toggle("selected", label.contains(input));
    });
    audio.play("click");
  });
});

$("#start-button").addEventListener("click", async () => {
  await audio.start();
  const prezone = document.querySelector("input[name='strategy']:checked").value;
  game = createGame({ seed: Date.now(), prezone });
  selected = null;
  globalThis.__pierbox = { getGame: () => game };
  $("#lobby").hidden = true;
  $("#game").hidden = false;
  render();
  $("#end-button").focus();
});

$("#sheet-button").addEventListener("click", () => {
  $("#sheet").hidden = true;
  $("#game").hidden = true;
  $("#lobby").hidden = false;
  $("#unlock-count").textContent = `${unlocks.length} / 2`;
  $("#start-button").focus();
  audio.play("click");
});

$("#sound-toggle").addEventListener("click", () => {
  audio.setEnabled(!audio.enabled);
  $("#sound-toggle").textContent = audio.enabled ? "♫ 聲音" : "♩ 靜音";
  $("#sound-toggle").setAttribute("aria-pressed", String(audio.enabled));
  if (audio.enabled) audio.play("click");
});

$("#help-button").addEventListener("click", () => {
  $("#help-sheet").hidden = false;
  $("#help-close").focus();
  audio.play("click");
});

$("#help-close").addEventListener("click", () => {
  $("#help-sheet").hidden = true;
  $("#help-button").focus();
  audio.play("click");
});

const progress = await loadProgress();
best = progress.best;
unlocks = progress.unlocks;
$("#best-score").textContent = String(best);
$("#unlock-count").textContent = `${unlocks.length} / 2`;
