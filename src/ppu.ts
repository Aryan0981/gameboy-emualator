import { Memory } from "./memory";
import { CPU } from "./cpu";

const MODE_HBLANK = 0; 
const MODE_VBLANK = 1; 
const MODE_OAM = 2;    
const MODE_DRAW = 3;   

const CYCLES_PER_LINE = 456;
const OAM_CYCLES = 80;          
const DRAW_CYCLES = 172;        

const VISIBLE_LINES = 144; 
const TOTAL_LINES = 154;   

export class PPU {
  private memory: Memory;
  private cpu: CPU;

  private modeClock = 0; 
  private mode = MODE_OAM;

  constructor(memory: Memory, cpu: CPU) {
    this.memory = memory;
    this.cpu = cpu;
  }

  private get ly(): number {
    return this.memory.read(0xff44);
  }

  private set ly(value: number) {
    this.memory.write(0xff44, value & 0xff);
  }

  private setMode(mode: number): void {
    this.mode = mode;
    const stat = this.memory.read(0xff41);
    this.memory.write(0xff41, (stat & 0xfc) | mode);
  }

  step(cycles: number): void {
    this.modeClock += cycles;

    switch (this.mode) {
      case MODE_OAM:
        if (this.modeClock >= OAM_CYCLES) {
          this.modeClock -= OAM_CYCLES;
          this.setMode(MODE_DRAW);
        }
        break;

      case MODE_DRAW:
        if (this.modeClock >= DRAW_CYCLES) {
          this.modeClock -= DRAW_CYCLES;
          this.setMode(MODE_HBLANK);
        }
        break;

      case MODE_HBLANK:
        if (this.modeClock >= CYCLES_PER_LINE - OAM_CYCLES - DRAW_CYCLES) {
          this.modeClock -= CYCLES_PER_LINE - OAM_CYCLES - DRAW_CYCLES;
          this.ly = this.ly + 1;

          if (this.ly === VISIBLE_LINES) {
            this.setMode(MODE_VBLANK);
            this.cpu.requestInterrupt(0); 
          } else {
            this.setMode(MODE_OAM);
          }
        }
        break;

      case MODE_VBLANK:
        if (this.modeClock >= CYCLES_PER_LINE) {
          this.modeClock -= CYCLES_PER_LINE;
          this.ly = this.ly + 1;

          if (this.ly >= TOTAL_LINES) {
            this.ly = 0;
            this.setMode(MODE_OAM);
          }
        }
        break;
    }
  }
}
