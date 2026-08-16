const EFFECTS = {
  click: "./assets/audio/click.ogg",
  contract: "./assets/audio/contract.ogg",
  alarm: "./assets/audio/alarm.ogg",
};

export class HarborAudio {
  constructor() {
    this.enabled = true;
    this.started = false;
    this.music = new Audio("./assets/audio/harbor-loop.ogg");
    this.music.loop = true;
    this.music.volume = 0.16;
    this.effects = Object.fromEntries(
      Object.entries(EFFECTS).map(([name, src]) => {
        const sound = new Audio(src);
        sound.volume = name === "alarm" ? 0.46 : 0.35;
        return [name, sound];
      }),
    );
  }

  async start() {
    this.started = true;
    if (!this.enabled) return;
    try {
      await this.music.play();
    } catch {
      // A later explicit interaction retries when autoplay is blocked.
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.music.pause();
    else if (this.started) void this.start();
  }

  play(name) {
    if (!this.enabled || !this.effects[name]) return;
    const effect = this.effects[name];
    effect.currentTime = 0;
    void effect.play().catch(() => {});
  }
}
