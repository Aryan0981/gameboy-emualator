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
  private hasBattery = false; // cartridge has battery-backed RAM (saves)
  ramDirty = false;           // set when RAM changes, so saves can be flushed
  private romBankHigh = 0;
  private romBank = 1;
  private ramBank = 0;

  // MBC3 real-time clock: live registers, latched snapshot, and latch state
  private rtcLatched = { sec: 0, min: 0, hour: 0, dayLow: 0, dayHigh: 0 };
  private rtcLatchArmed = false;
  private rtcBaseTime = Date.now();
  private ramEnabled = false;
  private mode = 0;
  private bankHigh = 0;

  connectJoypad(joypad: Joypad): void {
    this.joypad = joypad;
  }

  // Whether this cartridge saves (has battery-backed RAM)
  isBattery(): boolean {
    return this.hasBattery;
  }

  // Export the cartridge RAM so it can be persisted
  getRamSnapshot(): Uint8Array {
    return this.ram.slice();
  }

  // Restore previously-saved cartridge RAM
  loadRamSnapshot(saved: Uint8Array): void {
    this.ram.set(saved.subarray(0, this.ram.length));
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
    // Cart types that include a battery keep their RAM across power-off
    const batteryTypes = [0x03, 0x06, 0x09, 0x0d, 0x0f, 0x10, 0x13, 0x1b, 0x1e];
    this.hasBattery = batteryTypes.includes(type);

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
      // MBC3: RAM-bank values 0x08-0x0C map to the latched RTC registers
      if (this.mbc3 && this.ramBank >= 0x08) {
        return this.readRtc(this.ramBank);
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
        this.ram[(address - 0xa000) & 0x1ff] = value & 0x0f; // 4-bit
        this.ramDirty = true;
        return;
      }
      const bank = this.ramBankSelect();
      this.ram[bank * 0x2000 + (address - 0xa000)] = value;
      this.ramDirty = true;
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
      if (low === 0) low = 1; // bank 0 maps to 1 in the switchable slot
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
      this.ramBank = value & 0x0f; 
    } else {
      if (value === 0x01 && this.rtcLatchArmed) {
        this.latchRtc();
      }
      this.rtcLatchArmed = value === 0x00;
    }
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

  // Freeze the current elapsed time into the latched RTC snapshot
  private latchRtc(): void {
    const elapsed = Math.floor((Date.now() - this.rtcBaseTime) / 1000);
    this.rtcLatched.sec = elapsed % 60;
    this.rtcLatched.min = Math.floor(elapsed / 60) % 60;
    this.rtcLatched.hour = Math.floor(elapsed / 3600) % 24;
    const days = Math.floor(elapsed / 86400);
    this.rtcLatched.dayLow = days & 0xff;
    this.rtcLatched.dayHigh = (days >> 8) & 0x01;
  }

  // Read a latched RTC register (selected by RAM-bank values 0x08-0x0C)
  private readRtc(reg: number): number {
    switch (reg) {
      case 0x08: return this.rtcLatched.sec;
      case 0x09: return this.rtcLatched.min;
      case 0x0a: return this.rtcLatched.hour;
      case 0x0b: return this.rtcLatched.dayLow;
      case 0x0c: return this.rtcLatched.dayHigh;
      default: return 0xff;
    }
  }

  private ramBankSelect(): number {
    if (this.mbc3 || this.mbc5) return this.ramBank;
    return this.mode === 1 ? this.ramBank : 0;
  }
}