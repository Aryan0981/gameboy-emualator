import { Memory } from "./memory";
import { CPU } from "./cpu";
import { Timer } from "./timer";
import { PPU } from "./ppu";

// --- Screen setup ---
const WIDTH = 160;
const HEIGHT = 144;
const SCALE = 4; // draw at 4x so it's not tiny

const canvas = document.createElement("canvas");
canvas.width = WIDTH * SCALE;
canvas.height = HEIGHT * SCALE;
canvas.style.imageRendering = "pixelated";
canvas.style.border = "2px solid #333";
canvas.style.background = "#9bbc0f";
document.body.appendChild(canvas);

const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

// A file input so you can pick a .gb ROM from disk.
const input = document.createElement("input");
input.type = "file";
input.accept = ".gb";
document.body.insertBefore(input, canvas);
document.body.insertBefore(document.createElement("br"), canvas);

// The four Game Boy shades mapped to the classic green-tinted palette.
const SHADES = [
  [155, 188, 15], // 0 lightest
  [139, 172, 15], // 1
  [48, 98, 48],   // 2
  [15, 56, 15],   // 3 darkest
];

// An offscreen buffer we draw the 160x144 image into, then scale up.
const image = ctx.createImageData(WIDTH, HEIGHT);

let memory: Memory;
let cpu: CPU;
let timer: Timer;
let ppu: PPU;
let running = false;

// Roughly one frame's worth of CPU cycles.
const CYCLES_PER_FRAME = 70224;

function bootEmulator(rom: Uint8Array): void {
  memory = new Memory();
  memory.loadRom(rom);
  cpu = new CPU(memory);
  timer = new Timer(memory);
  ppu = new PPU(memory, cpu);

  // Post-boot register state (as if the boot ROM already ran).
  cpu.a = 0x01; cpu.f = 0xb0;
  cpu.b = 0x00; cpu.c = 0x13;
  cpu.d = 0x00; cpu.e = 0xd8;
  cpu.h = 0x01; cpu.l = 0x4d;
  cpu.sp = 0xfffe;
  cpu.pc = 0x0100;

  running = true;
  requestAnimationFrame(frame);
}

// Run one frame's worth of emulation, then paint the result.
function frame(): void {
  if (!running) return;

  let cyclesThisFrame = 0;
  while (cyclesThisFrame < CYCLES_PER_FRAME) {
    const cycles = cpu.step();
    timer.step(cycles);
    ppu.step(cycles);
    cyclesThisFrame += cycles;
  }

  paint();
  requestAnimationFrame(frame);
}

// Copy the PPU framebuffer into the canvas, scaled up.
function paint(): void {
  const data = image.data;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const shade = ppu.framebuffer[i];
    const [r, g, b] = SHADES[shade];
    const p = i * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }

  // Put the small image on a temporary canvas, then scale onto the visible one.
  const tmp = document.createElement("canvas");
  tmp.width = WIDTH;
  tmp.height = HEIGHT;
  tmp.getContext("2d")!.putImageData(image, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0, WIDTH * SCALE, HEIGHT * SCALE);
}

// When you pick a ROM file, boot it.
input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  bootEmulator(new Uint8Array(buffer));
});

console.log("Game Boy emulator ready - pick a .gb ROM to run");