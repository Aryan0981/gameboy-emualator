import { Memory } from "./memory";

// Game Boy APU. Implements the two square-wave channels (the main melodic
// sound); generates PCM samples that the browser layer feeds to Web Audio

const DUTY_PATTERNS = [
  [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
  [1, 0, 0, 0, 0, 0, 0, 1], // 25%
  [1, 0, 0, 0, 0, 1, 1, 1], // 50%
  [0, 1, 1, 1, 1, 1, 1, 0], // 75%
];

class SquareChannel {
  enabled = false;
  private dutyIndex = 0;
  private dutyStep = 0;
  private freqTimer = 0;
  private frequency = 0;
  private volume = 0;

  // Read this channel's registers 
  configure(duty: number, freq: number, volume: number): void {
    this.dutyIndex = duty & 3;
    this.frequency = freq;
    this.volume = volume & 0x0f;
    this.enabled = volume > 0;
  }

  // Advance by one CPU cycle
  tick(): number {
    if (this.freqTimer <= 0) {
      this.freqTimer = (2048 - this.frequency) * 4;
      this.dutyStep = (this.dutyStep + 1) & 7;
    }
    this.freqTimer--;

    if (!this.enabled) return 0;
    const bit = DUTY_PATTERNS[this.dutyIndex][this.dutyStep];
    return (bit ? 1 : -1) * (this.volume / 15);
  }
}

export class APU {
  private memory: Memory;
  private ch1 = new SquareChannel();
  private ch2 = new SquareChannel();

  constructor(memory: Memory) {
    this.memory = memory;
  }

  // Re-read the sound registers and reconfigure the channels
  private refresh(): void {
    const nr11 = this.memory.read(0xff11);
    const nr12 = this.memory.read(0xff12);
    const nr13 = this.memory.read(0xff13);
    const nr14 = this.memory.read(0xff14);
    const duty1 = (nr11 >> 6) & 3;
    const vol1 = (nr12 >> 4) & 0x0f;
    const freq1 = ((nr14 & 0x07) << 8) | nr13;
    this.ch1.configure(duty1, freq1, vol1);

    const nr21 = this.memory.read(0xff16);
    const nr22 = this.memory.read(0xff17);
    const nr23 = this.memory.read(0xff18);
    const nr24 = this.memory.read(0xff19);
    const duty2 = (nr21 >> 6) & 3;
    const vol2 = (nr22 >> 4) & 0x0f;
    const freq2 = ((nr24 & 0x07) << 8) | nr23;
    this.ch2.configure(duty2, freq2, vol2);
  }
  generateSamples(count: number, cyclesPerSample: number): Float32Array {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.refresh();
      let sample = 0;
      for (let c = 0; c < cyclesPerSample; c++) {
        sample = this.ch1.tick() + this.ch2.tick();
      }
      out[i] = sample * 0.25; 
    }
    return out;
  }
}
