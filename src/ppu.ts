import { Memory } from "./memory";
import { CPU } from "./cpu";

// PPU modes, stored in the low 2 bits of STAT (0xFF41)
const MODE_HBLANK = 0;
const MODE_VBLANK = 1;
const MODE_OAM = 2;
const MODE_DRAW = 3;

// Timing in CPU cycles: each line is OAM(80) + draw(172) + hblank(204) = 456
const CYCLES_PER_LINE = 456;
const OAM_CYCLES = 80;
const DRAW_CYCLES = 172;

const VISIBLE_LINES = 144;
const TOTAL_LINES = 154;

export class PPU {
  private memory: Memory;
  private cpu: CPU;

  private modeClock = 0;
  private mode = MODE_OAM;
  private statLine = false; 
  readonly framebuffer = new Uint8Array(160 * 144);

  // Background color number per pixel for the current line, so sprites can honor priority
  private bgColorLine = new Uint8Array(160);
  frameReady = false;

  constructor(memory: Memory, cpu: CPU) {
    this.memory = memory;
    this.cpu = cpu;
  }

  private get ly(): number {
    return this.memory.read(0xff44);
  }

  private set ly(value: number) {
    this.memory.write(0xff44, value & 0xff);
    this.updateLyc();
  }

  private setMode(mode: number): void {
    this.mode = mode;
    const stat = this.memory.read(0xff41);
    this.memory.write(0xff41, (stat & 0xfc) | mode);
    this.checkStatInterrupt();
  }

  // Set or clear the LYC=LY coincidence flag, then re-check the STAT interrupt
  private updateLyc(): void {
    const stat = this.memory.read(0xff41);
    const coincidence = this.ly === this.memory.read(0xff45);
    const newStat = coincidence ? (stat | 0x04) : (stat & ~0x04);
    this.memory.write(0xff41, newStat);
    this.checkStatInterrupt();
  }

  // STAT interrupt (bit 1) fires on the rising edge of any enabled source
  private checkStatInterrupt(): void {
    const stat = this.memory.read(0xff41);
    let fire = false;

    if ((stat & 0x40) && (stat & 0x04)) fire = true;             // LYC=LY
    if ((stat & 0x20) && this.mode === MODE_OAM) fire = true;    // OAM scan
    if ((stat & 0x10) && this.mode === MODE_VBLANK) fire = true; // V-Blank
    if ((stat & 0x08) && this.mode === MODE_HBLANK) fire = true; // H-Blank

    if (fire && !this.statLine) {
      this.cpu.requestInterrupt(1);
    }
    this.statLine = fire;
  }

  // Advance the PPU by the cycles the last instruction took
  step(cycles: number): void {
    this.modeClock += cycles;

    switch (this.mode) {
      case MODE_OAM:
        if (this.modeClock >= OAM_CYCLES) {
          this.modeClock -= OAM_CYCLES;
          this.setMode(MODE_DRAW);
        }
        break;

      case MODE_DRAW:
        if (this.modeClock >= DRAW_CYCLES) {
          this.modeClock -= DRAW_CYCLES;
          this.setMode(MODE_HBLANK);
          this.renderScanline();
        }
        break;

      case MODE_HBLANK:
        if (this.modeClock >= CYCLES_PER_LINE - OAM_CYCLES - DRAW_CYCLES) {
          this.modeClock -= CYCLES_PER_LINE - OAM_CYCLES - DRAW_CYCLES;
          this.ly = this.ly + 1;

          if (this.ly === VISIBLE_LINES) {
            // Last visible line done: enter V-Blank and fire its interrupt
            this.setMode(MODE_VBLANK);
            this.frameReady = true;
            this.cpu.requestInterrupt(0);
          } else {
            this.setMode(MODE_OAM);
          }
        }
        break;

      case MODE_VBLANK:
        if (this.modeClock >= CYCLES_PER_LINE) {
          this.modeClock -= CYCLES_PER_LINE;
          this.ly = this.ly + 1;

          if (this.ly >= TOTAL_LINES) {
            this.ly = 0;
            this.setMode(MODE_OAM);
          }
        }
        break;
    }
  }

  // Render one background line into the framebuffer at the current LY
  private renderScanline(): void {
    const lcdc = this.memory.read(0xff40);

    const lcdOn = (lcdc & 0x80) !== 0;
    const bgOn = (lcdc & 0x01) !== 0;

    const line = this.ly;
    if (line >= VISIBLE_LINES) {
      return;
    }

    if (!lcdOn || !bgOn) {
      for (let x = 0; x < 160; x++) {
        this.framebuffer[line * 160 + x] = 0;
      }
      return;
    }

    const mapBase = (lcdc & 0x08) !== 0 ? 0x9c00 : 0x9800;
    const dataBase = (lcdc & 0x10) !== 0 ? 0x8000 : 0x9000;
    const signedIndex = (lcdc & 0x10) === 0;

    const scy = this.memory.read(0xff42);
    const scx = this.memory.read(0xff43);
    const palette = this.memory.read(0xff47);

    const bgY = (line + scy) & 0xff;
    const tileRow = bgY >> 3;
    const pixelRowInTile = bgY & 7;

    for (let x = 0; x < 160; x++) {
      const bgX = (x + scx) & 0xff;
      const tileCol = bgX >> 3;
      const pixelColInTile = bgX & 7;

      const mapIndex = tileRow * 32 + tileCol;
      const tileNumber = this.memory.read(mapBase + mapIndex);

      let tileAddress: number;
      if (signedIndex) {
        const signed = tileNumber < 0x80 ? tileNumber : tileNumber - 0x100;
        tileAddress = dataBase + signed * 16;
      } else {
        tileAddress = dataBase + tileNumber * 16;
      }

      const lowByte = this.memory.read(tileAddress + pixelRowInTile * 2);
      const highByte = this.memory.read(tileAddress + pixelRowInTile * 2 + 1);

      const bitPosition = 7 - pixelColInTile;
      const lowBit = (lowByte >> bitPosition) & 1;
      const highBit = (highByte >> bitPosition) & 1;
      const colorNumber = (highBit << 1) | lowBit;

      const shade = (palette >> (colorNumber * 2)) & 0x03;

      this.bgColorLine[x] = colorNumber;
      this.framebuffer[line * 160 + x] = shade;
    }

    // Window draws over the background; sprites go over everything
    this.renderWindow(line, lcdc);
    this.renderSprites(line, lcdc);
  }

  // The window is a second tile layer at a fixed screen position (WX/WY)
  private renderWindow(line: number, lcdc: number): void {
    if ((lcdc & 0x20) === 0) {
      return; // window disabled
    }

    const wy = this.memory.read(0xff4a);
    const wx = this.memory.read(0xff4b) - 7; // WX has a 7px offset
    if (line < wy) {
      return; // window has not started on this line yet
    }

    const mapBase = (lcdc & 0x40) !== 0 ? 0x9c00 : 0x9800;
    const dataBase = (lcdc & 0x10) !== 0 ? 0x8000 : 0x9000;
    const signedIndex = (lcdc & 0x10) === 0;
    const palette = this.memory.read(0xff47);

    const winY = line - wy;
    const tileRow = winY >> 3;
    const pixelRowInTile = winY & 7;

    for (let x = 0; x < 160; x++) {
      if (x < wx) {
        continue; 
      }

      const winX = x - wx;
      const tileCol = winX >> 3;
      const pixelColInTile = winX & 7;

      const tileNumber = this.memory.read(mapBase + tileRow * 32 + tileCol);
      let tileAddress: number;
      if (signedIndex) {
        const signed = tileNumber < 0x80 ? tileNumber : tileNumber - 0x100;
        tileAddress = dataBase + signed * 16;
      } else {
        tileAddress = dataBase + tileNumber * 16;
      }

      const lowByte = this.memory.read(tileAddress + pixelRowInTile * 2);
      const highByte = this.memory.read(tileAddress + pixelRowInTile * 2 + 1);
      const bit = 7 - pixelColInTile;
      const colorNumber = (((highByte >> bit) & 1) << 1) | ((lowByte >> bit) & 1);
      const shade = (palette >> (colorNumber * 2)) & 0x03;

      this.bgColorLine[x] = colorNumber; 
      this.framebuffer[line * 160 + x] = shade;
    }
  }

  // Draw the sprites intersecting this scanline, over the background
  private renderSprites(line: number, lcdc: number): void {
    if ((lcdc & 0x02) === 0) {
      return;
    }

    const spriteHeight = (lcdc & 0x04) !== 0 ? 16 : 8;

    let drawn = 0;

    for (let i = 0; i < 40 && drawn < 10; i++) {
      const base = 0xfe00 + i * 4;
      const spriteY = this.memory.read(base + 0) - 16;
      const spriteX = this.memory.read(base + 1) - 8;
      let tile = this.memory.read(base + 2);
      const flags = this.memory.read(base + 3);

      if (line < spriteY || line >= spriteY + spriteHeight) {
        continue;
      }
      drawn++;

      const behindBg = (flags & 0x80) !== 0;
      const flipY = (flags & 0x40) !== 0;
      const flipX = (flags & 0x20) !== 0;
      const paletteAddr = (flags & 0x10) !== 0 ? 0xff49 : 0xff48;
      const palette = this.memory.read(paletteAddr);

      if (spriteHeight === 16) {
        tile &= 0xfe;
      }

      let row = line - spriteY;
      if (flipY) {
        row = spriteHeight - 1 - row;
      }

      const tileAddress = 0x8000 + tile * 16 + row * 2;
      const lowByte = this.memory.read(tileAddress);
      const highByte = this.memory.read(tileAddress + 1);

      for (let col = 0; col < 8; col++) {
        const screenX = spriteX + col;
        if (screenX < 0 || screenX >= 160) {
          continue;
        }

        const bit = flipX ? col : 7 - col;
        const lowBit = (lowByte >> bit) & 1;
        const highBit = (highByte >> bit) & 1;
        const colorNumber = (highBit << 1) | lowBit;

        if (colorNumber === 0) {
          continue;
        }

        if (behindBg && this.bgColorLine[screenX] !== 0) {
          continue;
        }

        const shade = (palette >> (colorNumber * 2)) & 0x03;
        this.framebuffer[line * 160 + screenX] = shade;
      }
    }
  }
}