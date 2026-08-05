import { Memory } from "./memory";

export class CPU {
  a = 0; f = 0;
  b = 0; c = 0;
  d = 0; e = 0;
  h = 0; l = 0;
  sp = 0;
  pc = 0;

  constructor(private memory: Memory) {}

  get bc() { return (this.b << 8) | this.c; }
  set bc(v: number) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  get de() { return (this.d << 8) | this.e; }
  set de(v: number) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  get hl() { return (this.h << 8) | this.l; }
  set hl(v: number) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  get af() { return (this.a << 8) | this.f; }
  set af(v: number) { this.a = (v >> 8) & 0xff; this.f = v & 0xf0; }

  get flagZ() { return (this.f & 0x80) !== 0; }
  get flagN() { return (this.f & 0x40) !== 0; }
  get flagH() { return (this.f & 0x20) !== 0; }
  get flagC() { return (this.f & 0x10) !== 0; }

  setFlags(z: boolean, n: boolean, h: boolean, c: boolean) {
    this.f = (z ? 0x80 : 0) | (n ? 0x40 : 0) | (h ? 0x20 : 0) | (c ? 0x10 : 0);
  }

  private fetch(): number {
    const byte = this.memory.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return byte;
  }

  step(): void {
    const opcode = this.fetch();
    this.execute(opcode);
  }

  private execute(opcode: number): void {
    switch (opcode) {
      case 0x00: break; // NOP
      default:
        console.warn(`Unknown opcode: 0x${opcode.toString(16).padStart(2, "0")}`);
    }
  }
}
