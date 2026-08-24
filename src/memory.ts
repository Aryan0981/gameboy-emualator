import { Joypad } from "./joypad";

// Memory bus with MBC1 cartridge bank-switching. The full ROM is kept
export class Memory {
  private data = new Uint8Array(0x10000); // work RAM, VRAM, I/O
  private rom = new Uint8Array(0x8000);   // full cartridge ROM
  private ram = new Uint8Array(0x8000);   // external cartridge RAM
  private joypad: Joypad | null = null;

  private mbc1 = false;
  private romBank = 1;
  private ramBank = 0;
  private ramEnabled = false;
  private mode = 0;
  private bankHigh = 0;

  connectJoypad(joypad: Joypad): void {
    this.joypad = joypad;
  }

  loadRom(rom: Uint8Array) {
    this.rom = new Uint8Array(rom.length);
    this.rom.set(rom);

    // Cartridge type byte at 0x0147 tells us the mapper
    const type = rom[0x0147];
    this.mbc1 = type >= 0x01 && type <= 0x03;

    for (let i = 0; i < rom.length && i < 0x8000; i++) this.data[i] = rom[i];
  }

  read(address: number): number {
    address &= 0xffff;

    if (address === 0xff00 && this.joypad !== null) {
      return this.joypad.read();
    }

    // Fixed ROM bank 0
    if (address < 0x4000) {
      return this.rom[address];
    }

    // Switchable ROM bank
    if (address < 0x8000) {
      const bank = this.mbc1 ? this.effectiveRomBank() : 1;
      const offset = bank * 0x4000 + (address - 0x4000);
      return offset < this.rom.length ? this.rom[offset] : 0xff;
    }

    // External cartridge RAM
    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled) return 0xff;
      const bank = this.mode === 1 ? this.ramBank : 0;
      return this.ram[bank * 0x2000 + (address - 0xa000)];
    }

    return this.data[address];
  }

  write(address: number, value: number): void {
    address &= 0xffff;
    value &= 0xff;

    if (address < 0x8000) {
      if (this.mbc1) this.mbcWrite(address, value);
      return;
    }

    if (address === 0xff00 && this.joypad !== null) {
      this.joypad.writeSelect(value);
      return;
    }

    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled) return;
      const bank = this.mode === 1 ? this.ramBank : 0;
      this.ram[bank * 0x2000 + (address - 0xa000)] = value;
      return;
    }

    this.data[address] = value;
  }

  // Each ROM-region range is a different MBC1 control register
  private mbcWrite(address: number, value: number): void {
    if (address < 0x2000) {
      this.ramEnabled = (value & 0x0f) === 0x0a;
    } else if (address < 0x4000) {
      let low = value & 0x1f;
      if (low === 0) low = 1; 
      this.romBank = low;
    } else if (address < 0x6000) {
      this.bankHigh = value & 0x03;
      this.ramBank = value & 0x03;
    } else {
      this.mode = value & 0x01;
    }
  }

  private effectiveRomBank(): number {
    if (this.mode === 0) {
      return (this.bankHigh << 5) | this.romBank;
    }
    return this.romBank;
  }
}