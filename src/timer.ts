import { Memory } from "./memory";

export class Timer {
  private memory: Memory;

  private divCounter = 0; // internal cycle accumulator for DIV
  private timaCounter = 0; // internal cycle accumulator for TIMA

  private static readonly RATES = [1024, 16, 64, 256];

  constructor(memory: Memory) {
    this.memory = memory;
  }

  // Advance the timer by the number of cycles the last instruction took.
  step(cycles: number): void {
    this.divCounter += cycles;
    while (this.divCounter >= 256) {
      this.divCounter -= 256;
      const div = this.memory.read(0xff04);
      this.memory.write(0xff04, (div + 1) & 0xff);
    }

    const tac = this.memory.read(0xff07);
    const enabled = (tac & 0x04) !== 0; // bit 2 turns the timer on
    if (!enabled) {
      return;
    }

    const rate = Timer.RATES[tac & 0x03];
    this.timaCounter += cycles;

    while (this.timaCounter >= rate) {
      this.timaCounter -= rate;

      let tima = this.memory.read(0xff05);
      tima++;

      if (tima > 0xff) {
        tima = this.memory.read(0xff06);
        const iff = this.memory.read(0xff0f);
        this.memory.write(0xff0f, iff | 0x04);
      }

      this.memory.write(0xff05, tima & 0xff);
    }
  }
}
