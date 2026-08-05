import { Memory } from "./memory";

export class CPU {
  private memory: Memory;

  // 8-bit registers
  a = 0;
  f = 0;
  b = 0;
  c = 0;
  d = 0;
  e = 0;
  h = 0;
  l = 0;

  // 16-bit registers
  sp = 0;
  pc = 0;

  constructor(memory: Memory) {
    this.memory = memory;
  }

  // --- 16-bit register pairs ---
  get bc() {
    return (this.b << 8) | this.c;
  }
  set bc(v: number) {
    this.b = (v >> 8) & 0xff;
    this.c = v & 0xff;
  }

  get de() {
    return (this.d << 8) | this.e;
  }
  set de(v: number) {
    this.d = (v >> 8) & 0xff;
    this.e = v & 0xff;
  }

  get hl() {
    return (this.h << 8) | this.l;
  }
  set hl(v: number) {
    this.h = (v >> 8) & 0xff;
    this.l = v & 0xff;
  }

  get af() {
    return (this.a << 8) | this.f;
  }
  set af(v: number) {
    this.a = (v >> 8) & 0xff;
    this.f = v & 0xf0; // low nibble of F is always 0
  }

  // --- Flags (bits inside register F) ---
  get flagZ() {
    return (this.f & 0x80) !== 0;
  }
  get flagN() {
    return (this.f & 0x40) !== 0;
  }
  get flagH() {
    return (this.f & 0x20) !== 0;
  }
  get flagC() {
    return (this.f & 0x10) !== 0;
  }

  setFlags(z: boolean, n: boolean, h: boolean, c: boolean) {
    this.f =
      (z ? 0x80 : 0) |
      (n ? 0x40 : 0) |
      (h ? 0x20 : 0) |
      (c ? 0x10 : 0);
  }

  // --- Register slot access (0-7). Slot 6 = the byte at address HL. ---
  private readReg(slot: number): number {
    switch (slot) {
      case 0:
        return this.b;
      case 1:
        return this.c;
      case 2:
        return this.d;
      case 3:
        return this.e;
      case 4:
        return this.h;
      case 5:
        return this.l;
      case 6:
        return this.memory.read(this.hl); // (HL): memory, not a register
      case 7:
        return this.a;
      default:
        return 0;
    }
  }

  private writeReg(slot: number, value: number): void {
    value &= 0xff;

    switch (slot) {
      case 0:
        this.b = value;
        break;
      case 1:
        this.c = value;
        break;
      case 2:
        this.d = value;
        break;
      case 3:
        this.e = value;
        break;
      case 4:
        this.h = value;
        break;
      case 5:
        this.l = value;
        break;
      case 6:
        this.memory.write(this.hl, value); // (HL)
        break;
      case 7:
        this.a = value;
        break;
    }
  }

  // --- Fetching ---
  private fetch(): number {
    const byte = this.memory.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return byte;
  }

  // Fetch a 16-bit little-endian value: low byte first, then high byte.
  private fetch16(): number {
    const low = this.fetch();
    const high = this.fetch();
    return (high << 8) | low;
  }

  step(): void {
    const opcode = this.fetch();
    this.execute(opcode);
  }

  private execute(opcode: number): void {
    // LD r, r' : opcodes 0x40-0x7F copy one register into another.
    // Destination = bits 3-5, source = bits 0-2.
    // Exception: 0x76 is HALT, not "LD (HL),(HL)".
    if (opcode >= 0x40 && opcode <= 0x7f && opcode !== 0x76) {
      const dest = (opcode >> 3) & 0x07;
      const src = opcode & 0x07;

      this.writeReg(dest, this.readReg(src));
      return;
    }

    // LD r, n : load the next byte (immediate) into a register. Dest = bits 3-5.
    if (
      opcode === 0x06 ||
      opcode === 0x0e ||
      opcode === 0x16 ||
      opcode === 0x1e ||
      opcode === 0x26 ||
      opcode === 0x2e ||
      opcode === 0x36 ||
      opcode === 0x3e
    ) {
      const dest = (opcode >> 3) & 0x07;
      const value = this.fetch(); // the immediate byte follows the opcode

      this.writeReg(dest, value);
      return;
    }

    switch (opcode) {
      case 0x00:
        break; // NOP

      case 0x76:
        break; // HALT (stub for now)

      // LD rr, nn : load a 16-bit little-endian immediate into a register pair.
      case 0x01:
        this.bc = this.fetch16(); // LD BC, nn
        break;
      case 0x11:
        this.de = this.fetch16(); // LD DE, nn
        break;
      case 0x21:
        this.hl = this.fetch16(); // LD HL, nn
        break;
      case 0x31:
        this.sp = this.fetch16(); // LD SP, nn
        break;

      default:
        console.warn(`Unknown opcode: 0x${opcode.toString(16).padStart(2, "0")}`);
    }
  }
}