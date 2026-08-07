export class Memory {
  private data = new Uint8Array(0x10000); // 0x0000 - 0xFFFF

  loadRom(rom: Uint8Array) {
    for (let i = 0; i < rom.length && i < 0x8000; i++) {
      this.data[i] = rom[i];
    }
  }

  read(address: number): number {
    address &= 0xffff;

    if (address <= 0x7fff) {
      return this.data[address];
    }
    if (address >= 0xff00 && address <= 0xff7f) {
      return this.data[address];
    }
    return this.data[address];
  }

  write(address: number, value: number): void {
    address &= 0xffff;
    value &= 0xff; 

    if (address <= 0x7fff) {
      return;
    }
    if (address >= 0xff00 && address <= 0xff7f) {
      this.data[address] = value;
      return;
    }
    this.data[address] = value;
  }
}
