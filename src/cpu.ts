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

  // --- The stack lives in memory and grows DOWNWARD. ---
  // Push: move SP down by 2, then store the 16-bit value (high byte first).
  private push16(value: number): void {
    this.sp = (this.sp - 1) & 0xffff;
    this.memory.write(this.sp, (value >> 8) & 0xff); // high byte
    this.sp = (this.sp - 1) & 0xffff;
    this.memory.write(this.sp, value & 0xff); // low byte
  }

  // Pop: read the 16-bit value (low byte first), then move SP up by 2.
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

  // RST: push current pc, then jump to a fixed low address.
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
    this.setFlags(this.a === 0, false, true, false); // H is always set for AND
  }

  private orA(value: number): void {
    this.a = this.a | value;
    this.setFlags(this.a === 0, false, false, false);
  }

  private xorA(value: number): void {
    this.a = this.a ^ value;
    this.setFlags(this.a === 0, false, false, false);
  }

  // CP = compare: subtract but DISCARD the result, keeping only the flags.
  private cpA(value: number): void {
    const result = this.a - value;

    const z = (result & 0xff) === 0;
    const h = ((this.a & 0x0f) - (value & 0x0f)) < 0;
    const c = result < 0;

    this.setFlags(z, true, h, c);
  }

  // --- INC/DEC helpers ---

  // 8-bit increment: sets Z, N=0, H; leaves Carry UNTOUCHED.
  private inc8(value: number): number {
    const result = (value + 1) & 0xff;
    const h = (value & 0x0f) + 1 > 0x0f;
    // Preserve the existing carry flag; only Z, N, H change.
    this.setFlags(result === 0, false, h, this.flagC);
    return result;
  }

  // 8-bit decrement: sets Z, N=1, H; leaves Carry UNTOUCHED.
  private dec8(value: number): number {
    const result = (value - 1) & 0xff;
    const h = (value & 0x0f) === 0; // borrow out of the low nibble
    this.setFlags(result === 0, true, h, this.flagC);
    return result;
  }

  // --- 16-bit ADD helper (ADD HL, rr) ---
  // Z is UNTOUCHED. N=0. H = carry out of bit 11. C = carry out of bit 15.
  private addHL(value: number): void {
    const result = this.hl + value;
    const h = (this.hl & 0x0fff) + (value & 0x0fff) > 0x0fff;
    const c = result > 0xffff;

    // Preserve Z; set N=0, H, C.
    this.setFlags(this.flagZ, false, h, c);
    this.hl = result & 0xffff;
  }

  // DAA: correct A back into binary-coded-decimal form after add/subtract.
  // Uses the N flag (was it a subtraction?) and the H/C flags to decide corrections.
  private daa(): void {
    let a = this.a;
    let correction = 0;
    let setCarry = false;

    if (!this.flagN) {
      // After an addition:
      if (this.flagH || (a & 0x0f) > 0x09) correction |= 0x06;
      if (this.flagC || a > 0x99) {
        correction |= 0x60;
        setCarry = true;
      }
      a = (a + correction) & 0xff;
    } else {
      // After a subtraction:
      if (this.flagH) correction |= 0x06;
      if (this.flagC) correction |= 0x60;
      a = (a - correction) & 0xff;
      setCarry = this.flagC;
    }

    this.a = a;
    // Z = result zero, N unchanged, H = 0 always, C per above.
    this.setFlags(a === 0, this.flagN, false, setCarry);
  }

  // --- Control-flow helpers ---

  private jumpIf(condition: boolean): void {
    const address = this.fetch16(); // always read the operand, even if not taken
    if (condition) {
      this.pc = address;
    }
  }

  private jumpRelativeIf(condition: boolean): void {
    const offset = this.toSigned(this.fetch()); // signed offset
    if (condition) {
      this.pc = (this.pc + offset) & 0xffff;
    }
  }

  private callIf(condition: boolean): void {
    const address = this.fetch16();
    if (condition) {
      this.push16(this.pc); // save where to come back to
      this.pc = address;
    }
  }

  step(): void {
    const opcode = this.fetch();

    if (opcode === 0xcb) {
      const cbOpcode = this.fetch(); // the real instruction is the next byte
      this.executeCB(cbOpcode);
      return;
    }

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

    // ALU on A: opcodes 0x80-0xBF. Source register = bits 0-2.
    // The operation is chosen by bits 3-5:
    //   0=ADD 1=ADC 2=SUB 3=SBC 4=AND 5=XOR 6=OR 7=CP
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

      case 0xf9: // LD SP, HL : copy the whole HL pair into the stack pointer
        this.sp = this.hl;
        break;

      case 0xe8: // ADD SP, n : add a SIGNED byte to SP. Z=0, N=0; H/C from the LOW byte.
        {
          const offset = this.toSigned(this.fetch());
          const result = (this.sp + offset) & 0xffff;
          // Half-carry and carry are computed on the low byte, as unsigned adds.
          const h = ((this.sp & 0x0f) + (offset & 0x0f)) > 0x0f;
          const c = ((this.sp & 0xff) + (offset & 0xff)) > 0xff;
          this.setFlags(false, false, h, c);
          this.sp = result;
        }
        break;

      case 0xf8: // LD HL, SP+n : HL = SP + signed byte. Same flag rules as ADD SP,n.
        {
          const offset = this.toSigned(this.fetch());
          const result = (this.sp + offset) & 0xffff;
          const h = ((this.sp & 0x0f) + (offset & 0x0f)) > 0x0f;
          const c = ((this.sp & 0xff) + (offset & 0xff)) > 0xff;
          this.setFlags(false, false, h, c);
          this.hl = result;
        }
        break;

      case 0x08: // LD (nn), SP : store SP to a direct address, low byte first
        {
          const address = this.fetch16();
          this.memory.write(address, this.sp & 0xff); // low byte
          this.memory.write((address + 1) & 0xffff, (this.sp >> 8) & 0xff); // high byte
        }
        break;

      // --- Jumps ---
      case 0xc3: // JP nn : jump to a 16-bit address
        this.pc = this.fetch16();
        break;

      case 0xc2: // JP NZ, nn : jump if Zero flag is CLEAR
        this.jumpIf(!this.flagZ);
        break;
      case 0xca: // JP Z, nn : jump if Zero flag is SET
        this.jumpIf(this.flagZ);
        break;
      case 0xd2: // JP NC, nn : jump if Carry flag is CLEAR
        this.jumpIf(!this.flagC);
        break;
      case 0xda: // JP C, nn : jump if Carry flag is SET
        this.jumpIf(this.flagC);
        break;

      case 0xe9: // JP (HL) : jump to the address in HL
        this.pc = this.hl;
        break;

      // --- Relative jumps (signed offset from current position) ---
      case 0x18: // JR n
        this.jumpRelativeIf(true);
        break;
      case 0x20: // JR NZ, n
        this.jumpRelativeIf(!this.flagZ);
        break;
      case 0x28: // JR Z, n
        this.jumpRelativeIf(this.flagZ);
        break;
      case 0x30: // JR NC, n
        this.jumpRelativeIf(!this.flagC);
        break;
      case 0x38: // JR C, n
        this.jumpRelativeIf(this.flagC);
        break;

      // --- Calls and returns (use the stack) ---
      case 0xcd: // CALL nn
        this.callIf(true);
        break;
      case 0xc4: // CALL NZ, nn
        this.callIf(!this.flagZ);
        break;
      case 0xcc: // CALL Z, nn
        this.callIf(this.flagZ);
        break;
      case 0xd4: // CALL NC, nn
        this.callIf(!this.flagC);
        break;
      case 0xdc: // CALL C, nn
        this.callIf(this.flagC);
        break;

      case 0xc9: // RET : pop return address off the stack
        this.pc = this.pop16();
        break;

      case 0xd9: // RETI : return, then re-enable interrupts
        this.pc = this.pop16();
        this.interruptsEnabled = true;
        break;
      case 0xc0: // RET NZ
        if (!this.flagZ) this.pc = this.pop16();
        break;
      case 0xc8: // RET Z
        if (this.flagZ) this.pc = this.pop16();
        break;
      case 0xd0: // RET NC
        if (!this.flagC) this.pc = this.pop16();
        break;
      case 0xd8: // RET C
        if (this.flagC) this.pc = this.pop16();
        break;

      // --- Stack push/pop of register pairs ---
      case 0xc5: // PUSH BC
        this.push16(this.bc);
        break;
      case 0xd5: // PUSH DE
        this.push16(this.de);
        break;
      case 0xe5: // PUSH HL
        this.push16(this.hl);
        break;
      case 0xf5: // PUSH AF
        this.push16(this.af);
        break;
      case 0xc1: // POP BC
        this.bc = this.pop16();
        break;
      case 0xd1: // POP DE
        this.de = this.pop16();
        break;
      case 0xe1: // POP HL
        this.hl = this.pop16();
        break;
      case 0xf1: // POP AF
        this.af = this.pop16();
        break;

      // --- 8-bit INC (dest = bits 3-5) ---
      case 0x04: // INC B
        this.b = this.inc8(this.b);
        break;
      case 0x0c: // INC C
        this.c = this.inc8(this.c);
        break;
      case 0x14: // INC D
        this.d = this.inc8(this.d);
        break;
      case 0x1c: // INC E
        this.e = this.inc8(this.e);
        break;
      case 0x24: // INC H
        this.h = this.inc8(this.h);
        break;
      case 0x2c: // INC L
        this.l = this.inc8(this.l);
        break;
      case 0x34: // INC (HL)
        this.memory.write(this.hl, this.inc8(this.memory.read(this.hl)));
        break;
      case 0x3c: // INC A
        this.a = this.inc8(this.a);
        break;

      // --- 8-bit DEC ---
      case 0x05: // DEC B
        this.b = this.dec8(this.b);
        break;
      case 0x0d: // DEC C
        this.c = this.dec8(this.c);
        break;
      case 0x15: // DEC D
        this.d = this.dec8(this.d);
        break;
      case 0x1d: // DEC E
        this.e = this.dec8(this.e);
        break;
      case 0x25: // DEC H
        this.h = this.dec8(this.h);
        break;
      case 0x2d: // DEC L
        this.l = this.dec8(this.l);
        break;
      case 0x35: // DEC (HL)
        this.memory.write(this.hl, this.dec8(this.memory.read(this.hl)));
        break;
      case 0x3d: // DEC A
        this.a = this.dec8(this.a);
        break;

      // --- 16-bit INC/DEC : NO flags are affected ---
      case 0x03: // INC BC
        this.bc = (this.bc + 1) & 0xffff;
        break;
      case 0x13: // INC DE
        this.de = (this.de + 1) & 0xffff;
        break;
      case 0x23: // INC HL
        this.hl = (this.hl + 1) & 0xffff;
        break;
      case 0x33: // INC SP
        this.sp = (this.sp + 1) & 0xffff;
        break;
      case 0x0b: // DEC BC
        this.bc = (this.bc - 1) & 0xffff;
        break;
      case 0x1b: // DEC DE
        this.de = (this.de - 1) & 0xffff;
        break;
      case 0x2b: // DEC HL
        this.hl = (this.hl - 1) & 0xffff;
        break;
      case 0x3b: // DEC SP
        this.sp = (this.sp - 1) & 0xffff;
        break;

      // --- 16-bit ADD (ADD HL, rr) ---
      case 0x09: // ADD HL, BC
        this.addHL(this.bc);
        break;
      case 0x19: // ADD HL, DE
        this.addHL(this.de);
        break;
      case 0x29: // ADD HL, HL
        this.addHL(this.hl);
        break;
      case 0x39: // ADD HL, SP
        this.addHL(this.sp);
        break;

      // --- Immediate ALU (operate A with the next byte) ---
      case 0xc6: // ADD A, n
        this.addA(this.fetch());
        break;
      case 0xce: // ADC A, n
        this.addA(this.fetch(), true);
        break;
      case 0xd6: // SUB A, n
        this.subA(this.fetch());
        break;
      case 0xde: // SBC A, n
        this.subA(this.fetch(), true);
        break;
      case 0xe6: // AND n
        this.andA(this.fetch());
        break;
      case 0xf6: // OR n
        this.orA(this.fetch());
        break;
      case 0xee: // XOR n
        this.xorA(this.fetch());
        break;
      case 0xfe: // CP n
        this.cpA(this.fetch());
        break;

      // --- Loads to/from A at an address in a register pair ---
      case 0x02: // LD (BC), A
        this.memory.write(this.bc, this.a);
        break;
      case 0x12: // LD (DE), A
        this.memory.write(this.de, this.a);
        break;
      case 0x0a: // LD A, (BC)
        this.a = this.memory.read(this.bc);
        break;
      case 0x1a: // LD A, (DE)
        this.a = this.memory.read(this.de);
        break;

      // --- HL auto-increment / auto-decrement loads ---
      case 0x22: // LD (HL+), A  -- store A, then HL++
        this.memory.write(this.hl, this.a);
        this.hl = (this.hl + 1) & 0xffff;
        break;
      case 0x32: // LD (HL-), A  -- store A, then HL--
        this.memory.write(this.hl, this.a);
        this.hl = (this.hl - 1) & 0xffff;
        break;
      case 0x2a: // LD A, (HL+)  -- load A, then HL++
        this.a = this.memory.read(this.hl);
        this.hl = (this.hl + 1) & 0xffff;
        break;
      case 0x3a: // LD A, (HL-)  -- load A, then HL--
        this.a = this.memory.read(this.hl);
        this.hl = (this.hl - 1) & 0xffff;
        break;

      // --- Direct-address loads (16-bit address in the instruction) ---
      case 0xea: // LD (nn), A
        this.memory.write(this.fetch16(), this.a);
        break;
      case 0xfa: // LD A, (nn)
        this.a = this.memory.read(this.fetch16());
        break;

      // --- High-memory (0xFF00+) loads: talk to I/O hardware ---
      case 0xe0: // LDH (n), A  -- write A to 0xFF00 + n
        this.memory.write(0xff00 + this.fetch(), this.a);
        break;
      case 0xf0: // LDH A, (n)  -- read from 0xFF00 + n into A
        this.a = this.memory.read(0xff00 + this.fetch());
        break;
      case 0xe2: // LD (C), A  -- write A to 0xFF00 + C
        this.memory.write(0xff00 + this.c, this.a);
        break;
      case 0xf2: // LD A, (C)  -- read from 0xFF00 + C into A
        this.a = this.memory.read(0xff00 + this.c);
        break;

      // --- Accumulator rotates (like CB rotates but on A; Z is always 0 here) ---
      case 0x07: // RLCA
        this.a = this.rlc(this.a);
        this.setFlags(false, false, false, this.flagC);
        break;
      case 0x0f: // RRCA
        this.a = this.rrc(this.a);
        this.setFlags(false, false, false, this.flagC);
        break;
      case 0x17: // RLA
        this.a = this.rl(this.a);
        this.setFlags(false, false, false, this.flagC);
        break;
      case 0x1f: // RRA
        this.a = this.rr(this.a);
        this.setFlags(false, false, false, this.flagC);
        break;

      // --- Flag / accumulator oddballs ---
      case 0x2f: // CPL : flip all bits of A. N=1, H=1.
        this.a = (~this.a) & 0xff;
        this.setFlags(this.flagZ, true, true, this.flagC);
        break;
      case 0x37: // SCF : set carry flag. N=0, H=0.
        this.setFlags(this.flagZ, false, false, true);
        break;
      case 0x3f: // CCF : flip carry flag. N=0, H=0.
        this.setFlags(this.flagZ, false, false, !this.flagC);
        break;

      case 0x27: // DAA : adjust A into valid BCD after an add/subtract
        this.daa();
        break;

      case 0x10: // STOP (stub: treat like NOP for now; consumes its extra byte)
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
      case 0xf3: // DI : disable interrupts
        this.interruptsEnabled = false;
        break;
      case 0xfb: // EI : enable interrupts
        this.interruptsEnabled = true;
        break;

      default:
        console.warn(`Unknown opcode: 0x${opcode.toString(16).padStart(2, "0")}`);
    }
  }

  // --- Rotate/shift helpers (each returns the result and sets flags) ---
  // For all of these on the Game Boy: N=0, H=0. Z = result is zero.
  // C receives the bit that was shifted out.

  private rlc(v: number): number { // rotate left, old bit 7 -> carry AND bit 0
    const carry = (v >> 7) & 1;
    const result = ((v << 1) | carry) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private rrc(v: number): number { // rotate right, old bit 0 -> carry AND bit 7
    const carry = v & 1;
    const result = ((v >> 1) | (carry << 7)) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private rl(v: number): number { // rotate left THROUGH carry
    const carry = (v >> 7) & 1;
    const result = ((v << 1) | (this.flagC ? 1 : 0)) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private rr(v: number): number { // rotate right THROUGH carry
    const carry = v & 1;
    const result = ((v >> 1) | (this.flagC ? 0x80 : 0)) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private sla(v: number): number { // shift left, 0 into bit 0
    const carry = (v >> 7) & 1;
    const result = (v << 1) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private sra(v: number): number { // shift right, bit 7 stays (arithmetic)
    const carry = v & 1;
    const result = ((v >> 1) | (v & 0x80)) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  private swap(v: number): number { // swap the two nibbles
    const result = ((v & 0x0f) << 4) | ((v & 0xf0) >> 4);
    this.setFlags(result === 0, false, false, false); // C=0 for SWAP
    return result;
  }

  private srl(v: number): number { // shift right, 0 into bit 7 (logical)
    const carry = v & 1;
    const result = (v >> 1) & 0xff;
    this.setFlags(result === 0, false, false, carry === 1);
    return result;
  }

  // Execute one CB-prefixed opcode.
  private executeCB(opcode: number): void {
    const slot = opcode & 0x07;        // which register (bits 0-2)
    const value = this.readReg(slot);

    if (opcode < 0x40) {
      // Rotates/shifts: the operation is chosen by bits 3-5.
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

    // BIT / RES / SET : bit number = bits 3-5, operation = bits 6-7.
    const bit = (opcode >> 3) & 0x07;

    if (opcode < 0x80) {
      // BIT b, r : test the bit, set Z accordingly. N=0, H=1. Carry untouched.
      const isZero = (value & (1 << bit)) === 0;
      this.setFlags(isZero, false, true, this.flagC);
      return;
    }

    if (opcode < 0xc0) {
      // RES b, r : clear the bit to 0. No flags change.
      this.writeReg(slot, value & ~(1 << bit));
      return;
    }

    // SET b, r : set the bit to 1. No flags change.
    this.writeReg(slot, value | (1 << bit));
  }
}