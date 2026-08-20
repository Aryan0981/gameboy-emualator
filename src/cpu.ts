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

  interruptsEnabled = false; 
  private eiDelay = 0;       
  private halted = false;    

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
    this.f = v & 0xf0; 
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
        return this.memory.read(this.hl); 
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
        this.memory.write(this.hl, value); 
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

  // --- The stack lives in memory and grows DOWNWARD. ---
    private push16(value: number): void {
    this.sp = (this.sp - 1) & 0xffff;
    this.memory.write(this.sp, (value >> 8) & 0xff); 
    this.sp = (this.sp - 1) & 0xffff;
    this.memory.write(this.sp, value & 0xff); 
  }

  private pop16(): number {
    const low = this.memory.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    const high = this.memory.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    return (high << 8) | low;
  }

  // Convert an unsigned byte (0-255) to a signed offset (-128 to +127).
  private toSigned(byte: number): number {
    return byte < 0x80 ? byte : byte - 0x100;
  }

  private rst(address: number): void {
    this.push16(this.pc);
    this.pc = address;
  }

  // --- ALU operations on register A. Each sets flags per Game Boy rules. ---
  private addA(value: number, withCarry: boolean = false): void {
    const carryIn = withCarry && this.flagC ? 1 : 0;
    const result = this.a + value + carryIn;

    const z = (result & 0xff) === 0;
    const h = ((this.a & 0x0f) + (value & 0x0f) + carryIn) > 0x0f;
    const c = result > 0xff;

    this.a = result & 0xff;
    this.setFlags(z, false, h, c);
  }

  private subA(value: number, withCarry: boolean = false): void {
    const carryIn = withCarry && this.flagC ? 1 : 0;
    const result = this.a - value - carryIn;

    const z = (result & 0xff) === 0;
    const h = ((this.a & 0x0f) - (value & 0x0f) - carryIn) < 0;
    const c = result < 0;

    this.a = result & 0xff;
    this.setFlags(z, true, h, c);
  }

  private andA(value: number): void {
    this.a = this.a & value;
    this.setFlags(this.a === 0, false, true, false); 
  }

  private orA(value: number): void {
    this.a = this.a | value;
    this.setFlags(this.a === 0, false, false, false);
  }

  private xorA(value: number): void {
    this.a = this.a ^ value;
    this.setFlags(this.a === 0, false, false, false);
  }

  private cpA(value: number): void {
    const result = this.a - value;

    const z = (result & 0xff) === 0;
    const h = ((this.a & 0x0f) - (value & 0x0f)) < 0;
    const c = result < 0;

    this.setFlags(z, true, h, c);
  }

  // --- INC/DEC helpers ---
  private inc8(value: number): number {
    const result = (value + 1) & 0xff;
    const h = (value & 0x0f) + 1 > 0x0f;
    this.setFlags(result === 0, false, h, this.flagC);
    return result;
  }

  // 8-bit decrement
  private dec8(value: number): number {
    const result = (value - 1) & 0xff;
    const h = (value & 0x0f) === 0; 
    this.setFlags(result === 0, true, h, this.flagC);
    return result;
  }

  // --- 16-bit ADD helper (ADD HL, rr) ---
  private addHL(value: number): void {
    const result = this.hl + value;
    const h = (this.hl & 0x0fff) + (value & 0x0fff) > 0x0fff;
    const c = result > 0xffff;

    this.setFlags(this.flagZ, false, h, c);
    this.hl = result & 0xffff;
  }

  private daa(): void {
    let a = this.a;
    let correction = 0;
    let setCarry = false;

    if (!this.flagN) {
      if (this.flagH || (a & 0x0f) > 0x09) correction |= 0x06;
      if (this.flagC || a > 0x99) {
        correction |= 0x60;
        setCarry = true;
      }
      a = (a + correction) & 0xff;
    } else {
      if (this.flagH) correction |= 0x06;
      if (this.flagC) correction |= 0x60;
      a = (a - correction) & 0xff;
      setCarry = this.flagC;
    }

    this.a = a;
    this.setFlags(a === 0, this.flagN, false, setCarry);
  }

  // --- Control-flow helpers ---
  private jumpIf(condition: boolean): void {
    const address = this.fetch16(); 
    if (condition) {
      this.pc = address;
    }
  }

  private jumpRelativeIf(condition: boolean): void {
    const offset = this.toSigned(this.fetch()); 
    if (condition) {
      this.pc = (this.pc + offset) & 0xffff;
    }
  }

  private callIf(condition: boolean): void {
    const address = this.fetch16();
    if (condition) {
      this.push16(this.pc);
      this.pc = address;
    }
  }

  private static readonly CYCLES: number[] = [
    4,12,8,8,4,4,8,4,20,8,8,8,4,4,8,4,
    4,12,8,8,4,4,8,4,12,8,8,8,4,4,8,4,
    8,12,8,8,4,4,8,4,8,8,8,8,4,4,8,4,
    8,12,8,8,12,12,12,4,8,8,8,8,4,4,8,4,
    4,4,4,4,4,4,8,4,4,4,4,4,4,4,8,4,
    4,4,4,4,4,4,8,4,4,4,4,4,4,4,8,4,
    4,4,4,4,4,4,8,4,4,4,4,4,4,4,8,4,
    8,8,8,8,8,8,4,8,4,4,4,4,4,4,8,4,
    4,4,4,4,4,4,8,4,4,4,4,4,4,4,8,4,
    4,4,4,4,4,4,8,4,4,4,4,4,4,4,8,4,
    4,4,4,4,4,4,8,4,4,4,4,4,4,4,8,4,
    4,4,4,4,4,4,8,4,4,4,4,4,4,4,8,4,
    8,12,12,16,12,16,8,16,8,16,12,4,12,24,8,16,
    8,12,12,4,12,16,8,16,8,16,12,4,12,4,8,16,
    12,12,8,4,4,16,8,16,16,4,16,4,4,4,8,16,
    12,12,8,4,4,16,8,16,12,8,16,4,4,4,8,16,
  ];

  step(): number {
    if (this.halted) {
      const ie = this.memory.read(0xffff);
      const iff = this.memory.read(0xff0f);
      if ((ie & iff & 0x1f) !== 0) {
        this.halted = false;
      } else {
        return 4; 
      }
    }

    if (this.handleInterrupts()) {
      return 20; 
    }

    if (this.eiDelay > 0) {
      this.eiDelay--;
      if (this.eiDelay === 0) {
        this.interruptsEnabled = true;
      }
    }

    const opcode = this.fetch();

    if (opcode === 0xcb) {
      const cbOpcode = this.fetch(); 
      this.executeCB(cbOpcode);
      return (cbOpcode & 0x07) === 6 ? 16 : 8;
    }

    this.execute(opcode);
    return CPU.CYCLES[opcode];
  }

  requestInterrupt(bit: number): void {
    const iff = this.memory.read(0xff0f);
    this.memory.write(0xff0f, iff | (1 << bit));
  }

  private handleInterrupts(): boolean {
    if (!this.interruptsEnabled) {
      return false; 
    }

    const ie = this.memory.read(0xffff); 
    const iff = this.memory.read(0xff0f); 
    const pending = ie & iff & 0x1f; 

    if (pending === 0) {
      return false; 
    }

    for (let bit = 0; bit < 5; bit++) {
      if (pending & (1 << bit)) {
        this.interruptsEnabled = false;
        this.memory.write(0xff0f, iff & ~(1 << bit)); 
        this.push16(this.pc); 
        this.pc = 0x0040 + bit * 0x08; 
        return true;
      }
    }

    return false;
  }

  private execute(opcode: number): void {
    if (opcode >= 0x40 && opcode <= 0x7f && opcode !== 0x76) {
      const dest = (opcode >> 3) & 0x07;
      const src = opcode & 0x07;

      this.writeReg(dest, this.readReg(src));
      return;
    }

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
      const value = this.fetch(); 

      this.writeReg(dest, value);
      return;
    }

    if (opcode >= 0x80 && opcode <= 0xbf) {
      const src = opcode & 0x07;
      const value = this.readReg(src);
      const op = (opcode >> 3) & 0x07;

      switch (op) {
        case 0:
          this.addA(value);
          break;
        case 1:
          this.addA(value, true);
          break;
        case 2:
          this.subA(value);
          break;
        case 3:
          this.subA(value, true);
          break;
        case 4:
          this.andA(value);
          break;
        case 5:
          this.xorA(value);
          break;
        case 6:
          this.orA(value);
          break;
        case 7:
          this.cpA(value);
          break;
      }
      return;
    }

    switch (opcode) {
      case 0x00:
        break; 

      case 0x76:
        this.halted = true; 
        break;

      case 0x01:
        this.bc = this.fetch16(); 
        break;
      case 0x11:
        this.de = this.fetch16(); 
        break;
      case 0x21:
        this.hl = this.fetch16(); 
        break;
      case 0x31:
        this.sp = this.fetch16(); 
        break;

      case 0xf9: 
        this.sp = this.hl;
        break;

      case 0xe8: 
        {
          const offset = this.toSigned(this.fetch());
          const result = (this.sp + offset) & 0xffff;
          const h = ((this.sp & 0x0f) + (offset & 0x0f)) > 0x0f;
          const c = ((this.sp & 0xff) + (offset & 0xff)) > 0xff;
          this.setFlags(false, false, h, c);
          this.sp = result;
        }
        break;

      case 0xf8:
        {
          const offset = this.toSigned(this.fetch());
          const result = (this.sp + offset) & 0xffff;
          const h = ((this.sp & 0x0f) + (offset & 0x0f)) > 0x0f;
          const c = ((this.sp & 0xff) + (offset & 0xff)) > 0xff;
          this.setFlags(false, false, h, c);
          this.hl = result;
        }
        break;

      case 0x08: 
        {
          const address = this.fetch16();
          this.memory.write(address, this.sp & 0xff); 
          this.memory.write((address + 1) & 0xffff, (this.sp >> 8) & 0xff); 
        }
        break;

      // --- Jumps ---
      case 0xc3: 
        this.pc = this.fetch16();
        break;

      case 0xc2: 
        this.jumpIf(!this.flagZ);
        break;
      case 0xca:
        this.jumpIf(this.flagZ);
        break;
      case 0xd2: 
        this.jumpIf(!this.flagC);
        break;
      case 0xda: 
        this.jumpIf(this.flagC);
        break;

      case 0xe9: 
        this.pc = this.hl;
        break;

      // --- Relative jumps (signed offset from current position) ---
      case 0x18: 
        this.jumpRelativeIf(true);
        break;
      case 0x20: 
        this.jumpRelativeIf(!this.flagZ);
        break;
      case 0x28: 
        this.jumpRelativeIf(this.flagZ);
        break;
      case 0x30: 
        this.jumpRelativeIf(!this.flagC);
        break;
      case 0x38: 
        this.jumpRelativeIf(this.flagC);
        break;

      // --- Calls and returns (use the stack) ---
      case 0xcd: 
        this.callIf(true);
        break;
      case 0xc4: 
        this.callIf(!this.flagZ);
        break;
      case 0xcc: 
        this.callIf(this.flagZ);
        break;
      case 0xd4: 
        this.callIf(!this.flagC);
        break;
      case 0xdc: 
        this.callIf(this.flagC);
        break;

      case 0xc9: 
        this.pc = this.pop16();
        break;

      case 0xd9: 
        this.pc = this.pop16();
        this.interruptsEnabled = true;
        break;
      case 0xc0: 
        if (!this.flagZ) this.pc = this.pop16();
        break;
      case 0xc8: 
        if (this.flagZ) this.pc = this.pop16();
        break;
      case 0xd0: 
        if (!this.flagC) this.pc = this.pop16();
        break;
      case 0xd8:
        if (this.flagC) this.pc = this.pop16();
        break;

      // --- Stack push/pop of register pairs ---
      case 0xc5:
        this.push16(this.bc);
        break;
      case 0xd5: 
        this.push16(this.de);
        break;
      case 0xe5:
        this.push16(this.hl);
        break;
      case 0xf5: 
        this.push16(this.af);
        break;
      case 0xc1: 
        this.bc = this.pop16();
        break;
      case 0xd1:
        this.de = this.pop16();
        break;
      case 0xe1: 
        this.hl = this.pop16();
        break;
      case 0xf1: 
        this.af = this.pop16();
        break;

      // --- 8-bit INC (dest = bits 3-5) ---
      case 0x04: 
        this.b = this.inc8(this.b);
        break;
      case 0x0c: 
        this.c = this.inc8(this.c);
        break;
      case 0x14: 
        this.d = this.inc8(this.d);
        break;
      case 0x1c: 
        this.e = this.inc8(this.e);
        break;
      case 0x24: 
        this.h = this.inc8(this.h);
        break;
      case 0x2c: 
        this.l = this.inc8(this.l);
        break;
      case 0x34: 
        this.memory.write(this.hl, this.inc8(this.memory.read(this.hl)));
        break;
      case 0x3c: 
        this.a = this.inc8(this.a);
        break;

      // --- 8-bit DEC ---
      case 0x05: 
        this.b = this.dec8(this.b);
        break;
      case 0x0d: 
        this.c = this.dec8(this.c);
        break;
      case 0x15: 
        this.d = this.dec8(this.d);
        break;
      case 0x1d: 
        this.e = this.dec8(this.e);
        break;
      case 0x25: 
        this.h = this.dec8(this.h);
        break;
      case 0x2d: 
        this.l = this.dec8(this.l);
        break;
      case 0x35: 
        this.memory.write(this.hl, this.dec8(this.memory.read(this.hl)));
        break;
      case 0x3d: 
        this.a = this.dec8(this.a);
        break;

      // --- 16-bit INC/DEC : NO flags are affected ---
      case 0x03: 
        this.bc = (this.bc + 1) & 0xffff;
        break;
      case 0x13: 
        this.de = (this.de + 1) & 0xffff;
        break;
      case 0x23: 
        this.hl = (this.hl + 1) & 0xffff;
        break;
      case 0x33: 
        this.sp = (this.sp + 1) & 0xffff;
        break;
      case 0x0b: 
        this.bc = (this.bc - 1) & 0xffff;
        break;
      case 0x1b: 
        this.de = (this.de - 1) & 0xffff;
        break;
      case 0x2b: 
        this.hl = (this.hl - 1) & 0xffff;
        break;
      case 0x3b:
        this.sp = (this.sp - 1) & 0xffff;
        break;

      // --- 16-bit ADD (ADD HL, rr) ---
      case 0x09:
        this.addHL(this.bc);
        break;
      case 0x19: 
        this.addHL(this.de);
        break;
      case 0x29: 
        this.addHL(this.hl);
        break;
      case 0x39: 
        this.addHL(this.sp);
        break;

      // --- Immediate ALU (operate A with the next byte) ---
      case 0xc6: 
        this.addA(this.fetch());
        break;
      case 0xce: 
        this.addA(this.fetch(), true);
        break;
      case 0xd6: 
        this.subA(this.fetch());
        break;
      case 0xde: 
        this.subA(this.fetch(), true);
        break;
      case 0xe6: 
        this.andA(this.fetch());
        break;
      case 0xf6: 
        this.orA(this.fetch());
        break;
      case 0xee: 
        this.xorA(this.fetch());
        break;
      case 0xfe: 
        this.cpA(this.fetch());
        break;

      // --- Loads to/from A at an address in a register pair ---
      case 0x02:
        this.memory.write(this.bc, this.a);
        break;
      case 0x12: 
        this.memory.write(this.de, this.a);
        break;
      case 0x0a:
        this.a = this.memory.read(this.bc);
        break;
      case 0x1a: 
        this.a = this.memory.read(this.de);
        break;

      // --- HL auto-increment / auto-decrement loads ---
      case 0x22: 
        this.memory.write(this.hl, this.a);
        this.hl = (this.hl + 1) & 0xffff;
        break;
      case 0x32: 
        this.memory.write(this.hl, this.a);
        this.hl = (this.hl - 1) & 0xffff;
        break;
      case 0x2a: 
        this.a = this.memory.read(this.hl);
        this.hl = (this.hl + 1) & 0xffff;
        break;
      case 0x3a: 
        this.a = this.memory.read(this.hl);
        this.hl = (this.hl - 1) & 0xffff;
        break;

      // --- Direct-address loads (16-bit address in the instruction) ---
      case 0xea: 
        this.memory.write(this.fetch16(), this.a);
        break;
      case 0xfa: 
        this.a = this.memory.read(this.fetch16());
        break;

      // --- High-memory (0xFF00+) loads: talk to I/O hardware ---
      case 0xe0: 
        this.memory.write(0xff00 + this.fetch(), this.a);
        break;
      case 0xf0: 
        this.a = this.memory.read(0xff00 + this.fetch());
        break;
      case 0xe2: 
        this.memory.write(0xff00 + this.c, this.a);
        break;
      case 0xf2: 
        this.a = this.memory.read(0xff00 + this.c);
        break;

      // --- Accumulator rotates (like CB rotates but on A; Z is always 0 here) ---
      case 0x07: 
        this.a = this.rlc(this.a);
        this.setFlags(false, false, false, this.flagC);
        break;
      case 0x0f: 
        this.a = this.rrc(this.a);
        this.setFlags(false, false, false, this.flagC);
        break;
      case 0x17:
        this.a = this.rl(this.a);
        this.setFlags(false, false, false, this.flagC);
        break;
      case 0x1f: 
        this.a = this.rr(this.a);
        this.setFlags(false, false, false, this.flagC);
        break;

      // --- Flag / accumulator oddballs ---
      case 0x2f: 
        this.a = (~this.a) & 0xff;
        this.setFlags(this.flagZ, true, true, this.flagC);
        break;
      case 0x37: 
        this.setFlags(this.flagZ, false, false, true);
        break;
      case 0x3f: 
        this.setFlags(this.flagZ, false, false, !this.flagC);
        break;

      case 0x27: 
        this.daa();
        break;

      case 0x10: 
        this.fetch();
        break;

      // --- RST : fast call to a fixed low address ---
      case 0xc7: this.rst(0x00); break;
      case 0xcf: this.rst(0x08); break;
      case 0xd7: this.rst(0x10); break;
      case 0xdf: this.rst(0x18); break;
      case 0xe7: this.rst(0x20); break;
      case 0xef: this.rst(0x28); break;
      case 0xf7: this.rst(0x30); break;
      case 0xff: this.rst(0x38); break;

      // --- Interrupt enable/disable (stubbed; full behavior later) ---
      case 0xf3:
        this.interruptsEnabled = false;
        this.eiDelay = 0;
        break;
      case 0xfb:
        this.eiDelay = 2; 
        break;

      default:
        console.warn(`Unknown opcode: 0x${opcode.toString(16).padStart(2, "0")}`);
    }
  }

  // --- Rotate/shift helpers (each returns the result and sets flags) ---
  private rlc(v: number): number { 
    const carry = (v >> 7) & 1;
    const result = ((v << 1) | carry) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private rrc(v: number): number { 
    const carry = v & 1;
    const result = ((v >> 1) | (carry << 7)) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private rl(v: number): number {
    const carry = (v >> 7) & 1;
    const result = ((v << 1) | (this.flagC ? 1 : 0)) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private rr(v: number): number { 
    const carry = v & 1;
    const result = ((v >> 1) | (this.flagC ? 0x80 : 0)) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private sla(v: number): number { 
    const carry = (v >> 7) & 1;
    const result = (v << 1) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private sra(v: number): number { 
    const carry = v & 1;
    const result = ((v >> 1) | (v & 0x80)) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private swap(v: number): number { 
    const result = ((v & 0x0f) << 4) | ((v & 0xf0) >> 4);
    this.setFlags(result === 0, false, false, false); 
    return result;
  }

  private srl(v: number): number { 
    const carry = v & 1;
    const result = (v >> 1) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private executeCB(opcode: number): void {
    const slot = opcode & 0x07;       
    const value = this.readReg(slot);

    if (opcode < 0x40) {
      const op = (opcode >> 3) & 0x07;
      let result = 0;

      switch (op) {
        case 0: result = this.rlc(value); break;
        case 1: result = this.rrc(value); break;
        case 2: result = this.rl(value); break;
        case 3: result = this.rr(value); break;
        case 4: result = this.sla(value); break;
        case 5: result = this.sra(value); break;
        case 6: result = this.swap(value); break;
        case 7: result = this.srl(value); break;
      }

      this.writeReg(slot, result);
      return;
    }

    const bit = (opcode >> 3) & 0x07;

    if (opcode < 0x80) {
      const isZero = (value & (1 << bit)) === 0;
      this.setFlags(isZero, false, true, this.flagC);
      return;
    }

    if (opcode < 0xc0) {
      this.writeReg(slot, value & ~(1 << bit));
      return;
    }

    this.writeReg(slot, value | (1 << bit));
  }
}