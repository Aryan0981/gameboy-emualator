// The Game Boy memory bus: routes every read and write to the right region.
// Today: real storage for the RAM-like regions; hardware regions stubbed for later.

export class Memory {
  // One flat 64KB array backs the storage-like regions.
  // We route through read()/write() so we can special-case regions as we build them.
  private data = new Uint8Array(0x10000); // 0x0000 - 0xFFFF

  // Load a cartridge ROM into the cartridge region (0x0000-0x7FFF).
  loadRom(rom: Uint8Array) {
    for (let i = 0; i < rom.length && i < 0x8000; i++) {
      this.data[i] = rom[i];
    }
  }

  // Read one byte from the given 16-bit address.
  read(address: number): number {
    address &= 0xffff; // safety: keep it inside the 16-bit range

    if (address <= 0x7fff) {
      // Cartridge ROM — the game. Read-only, but reading is fine.
      return this.data[address];
    }
    if (address >= 0xff00 && address <= 0xff7f) {
      // I/O registers — real hardware. TODO: wire up when we build those systems.
      return this.data[address];
    }
    // Everything else (VRAM, work RAM, OAM, HRAM, etc.) is plain storage for now.
    return this.data[address];
  }

  // Write one byte to the given 16-bit address.
  write(address: number, value: number): void {
    address &= 0xffff;
    value &= 0xff; // a byte only holds 0-255

    if (address <= 0x7fff) {
      // Cartridge ROM is READ-ONLY. Writes here do nothing on real hardware.
      // (Later, some cartridges use writes here to switch memory banks — TODO.)
      return;
    }
    if (address >= 0xff00 && address <= 0xff7f) {
      // I/O registers — TODO: route to real hardware as we build it.
      this.data[address] = value;
      return;
    }
    // Everything else is plain writable storage for now.
    this.data[address] = value;
  }
}
