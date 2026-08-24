import { Joypad } from "./joypad";

export class Memory {
  private data = new Uint8Array(0x10000);
  private joypad: Joypad | null = null;

  connectJoypad(joypad: Joypad): void {
    this.joypad = joypad;
  }

  loadRom(rom: Uint8Array) {
    for (let i = 0; i < rom.length && i < 0x8000; i++) this.data[i] = rom[i];
  }

  read(address: number): number {
    address &= 0xffff;

    // 0xFF00 is the joypad register, not plain RAM
    if (address === 0xff00 && this.joypad !== null) {
      return this.joypad.read();
    }

    return this.data[address];
  }

  write(address: number, value: number): void {
    address &= 0xffff;
    value &= 0xff;

    if (address <= 0x7fff) return; 

    if (address === 0xff00 && this.joypad !== null) {
      this.joypad.writeSelect(value);
      return;
    }

    this.data[address] = value;
  }
}