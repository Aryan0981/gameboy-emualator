// Joypad: all 8 buttons report through the single 0xFF00 register
export class Joypad {
  private up = false;
  private down = false;
  private left = false;
  private right = false;
  private a = false;
  private b = false;
  private start = false;
  private select = false;

  private selectButtons = false;
  private selectDpad = false;

  setButton(name: string, pressed: boolean): void {
    switch (name) {
      case "up": this.up = pressed; break;
      case "down": this.down = pressed; break;
      case "left": this.left = pressed; break;
      case "right": this.right = pressed; break;
      case "a": this.a = pressed; break;
      case "b": this.b = pressed; break;
      case "start": this.start = pressed; break;
      case "select": this.select = pressed; break;
    }
  }

  // The game writes bits 4-5 to choose which button group it wants to read
  writeSelect(value: number): void {
    this.selectDpad = (value & 0x10) === 0;
    this.selectButtons = (value & 0x20) === 0;
  }

  read(): number {
    // Start all-released, then clear a bit for each held button in the selected group
    let low = 0x0f;

    if (this.selectDpad) {
      if (this.right) low &= ~0x01;
      if (this.left) low &= ~0x02;
      if (this.up) low &= ~0x04;
      if (this.down) low &= ~0x08;
    }

    if (this.selectButtons) {
      if (this.a) low &= ~0x01;
      if (this.b) low &= ~0x02;
      if (this.select) low &= ~0x04;
      if (this.start) low &= ~0x08;
    }

    let high = 0xc0;
    if (!this.selectDpad) high |= 0x10;
    if (!this.selectButtons) high |= 0x20;

    return high | low;
  }
}
