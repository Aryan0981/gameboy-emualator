import { Joypad } from "./joypad";

// Memory bus with MBC1/MBC3 cartridge bank-switching, plus OAM DMA
export class Memory {
  private data = new Uint8Array(0x10000); // work RAM, VRAM, I/O
  private rom = new Uint8Array(0x8000);   // full cartridge ROM
  private ram = new Uint8Array(0x8000);   // external cartridge RAM
  private joypad: Joypad | null = null;

  private mbc1 = false;
  private mbc3 = false;
  private mbc5 = false;
  private mbc2 = false;
  private romBankHigh = 0; 
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
    this.mbc3 = type >= 0x0f && type <= 0x13;
    this.mbc5 = type >= 0x19 && type <= 0x1e;
    this.mbc2 = type === 0x05 || type === 0x06;

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
      const bank = (this.mbc1 || this.mbc3 || this.mbc5 || this.mbc2) ? this.effectiveRomBank() : 1;
      const offset = bank * 0x4000 + (address - 0x4000);
      return offset < this.rom.length ? this.rom[offset] : 0xff;
    }

    // External cartridge RAM
    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled) return 0xff;
      if (this.mbc2) {
        return 0xf0 | (this.ram[(address - 0xa000) & 0x1ff] & 0x0f); 
      }
      const bank = this.ramBankSelect();
      return this.ram[bank * 0x2000 + (address - 0xa000)];
    }

    return this.data[address];
  }

  write(address: number, value: number): void {
    address &= 0xffff;
    value &= 0xff;

    // Writes to the ROM region are mapper control commands, not data
    if (address < 0x8000) {
      if (this.mbc1) this.mbc1Write(address, value);
      else if (this.mbc3) this.mbc3Write(address, value);
      else if (this.mbc5) this.mbc5Write(address, value);
      else if (this.mbc2) this.mbc2Write(address, value);
      return;
    }

    // 0xFF46: OAM DMA - copy 160 bytes from (value * 0x100) into OAM
    if (address === 0xff46) {
      const source = value << 8;
      for (let i = 0; i < 0xa0; i++) {
        this.data[0xfe00 + i] = this.read(source + i);
      }
      this.data[address] = value;
      return;
    }

    if (address === 0xff00 && this.joypad !== null) {
      this.joypad.writeSelect(value);
      return;
    }

    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled) return;
      if (this.mbc2) {
        this.ram[(address - 0xa000) & 0x1ff] = value & 0x0f; 
        return;
      }
      const bank = this.ramBankSelect();
      this.ram[bank * 0x2000 + (address - 0xa000)] = value;
      return;
    }

    this.data[address] = value;
  }

  // Each ROM-region range is a different MBC1 control register
  private mbc1Write(address: number, value: number): void {
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

  // MBC3 sets a full 7-bit ROM bank in one write; RAM bank on 0x4000-0x5FFF
  private mbc3Write(address: number, value: number): void {
    if (address < 0x2000) {
      this.ramEnabled = (value & 0x0f) === 0x0a;
    } else if (address < 0x4000) {
      let bank = value & 0x7f;
      if (bank === 0) bank = 1; 
      this.romBank = bank;
    } else if (address < 0x6000) {
      this.ramBank = value & 0x03; 
    }
    // 0x6000-0x7FFF latches the real-time clock, which we don't emulate
  }

  // MBC2: address bit 8 picks RAM-enable (0) vs ROM-bank (1); 4-bit bank
  private mbc2Write(address: number, value: number): void {
    if (address < 0x4000) {
      if (address & 0x0100) {
        let bank = value & 0x0f;
        if (bank === 0) bank = 1;
        this.romBank = bank;
      } else {
        this.ramEnabled = (value & 0x0f) === 0x0a;
      }
    }
  }

  // MBC5: 8 low ROM-bank bits, a 9th bit, and a RAM bank; no bank-0 quirk
  private mbc5Write(address: number, value: number): void {
    if (address < 0x2000) {
      this.ramEnabled = (value & 0x0f) === 0x0a;
    } else if (address < 0x3000) {
      this.romBank = value;
    } else if (address < 0x4000) {
      this.romBankHigh = value & 0x01; 
    } else if (address < 0x6000) {
      this.ramBank = value & 0x0f;
    }
  }

  private effectiveRomBank(): number {
    if (this.mbc2) {
      return this.romBank; 
    }
    if (this.mbc5) {
      return (this.romBankHigh << 8) | this.romBank; 
    }
    if (this.mbc3) {
      return this.romBank; 
    }
    // MBC1: in mode 0 the high bits extend the ROM bank number
    if (this.mode === 0) {
      return (this.bankHigh << 5) | this.romBank;
    }
    return this.romBank;
  }

  private ramBankSelect(): number {
    if (this.mbc3 || this.mbc5) return this.ramBank;
    return this.mode === 1 ? this.ramBank : 0;
  }
}