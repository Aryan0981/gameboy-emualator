import { Memory } from "./memory";
import { CPU } from "./cpu";
import { Timer } from "./timer";
import { PPU } from "./ppu";
import { Joypad } from "./joypad";
import { APU } from "./apu";

const WIDTH = 160;
const HEIGHT = 144;
const SCALE = 4;

// Screen: a 160x144 canvas scaled up 4x
const canvas = document.createElement("canvas");
canvas.width = WIDTH * SCALE;
canvas.height = HEIGHT * SCALE;
canvas.style.imageRendering = "pixelated";
canvas.style.border = "2px solid #333";
canvas.style.background = "#9bbc0f";
document.body.appendChild(canvas);

const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const input = document.createElement("input");
input.type = "file";
input.accept = ".gb";
document.body.insertBefore(input, canvas);
document.body.insertBefore(document.createElement("br"), canvas);

// The four Game Boy shades, mapped to the classic green palette
const SHADES = [
  [155, 188, 15],
  [139, 172, 15],
  [48, 98, 48],
  [15, 56, 15],
];

const image = ctx.createImageData(WIDTH, HEIGHT);

let memory: Memory;
let cpu: CPU;
let timer: Timer;
let ppu: PPU;
let apu: APU;
let running = false;

// Web Audio setup: pull samples from the APU on demand
let audioCtx: AudioContext | null = null;
const SAMPLE_RATE = 44100;
const CPU_HZ = 4194304;

// Keyboard -> Game Boy buttons
const joypad = new Joypad();

const KEY_MAP: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  z: "a",
  x: "b",
  Enter: "start",
  Shift: "select",
};

window.addEventListener("keydown", (e) => {
  const button = KEY_MAP[e.key];
  if (button) {
    joypad.setButton(button, true);
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  const button = KEY_MAP[e.key];
  if (button) {
    joypad.setButton(button, false);
    e.preventDefault();
  }
});

const CYCLES_PER_FRAME = 70224;

// Feed APU samples to the speakers via Web Audio
function setupAudio(): void {
  if (audioCtx) return; // set up once
  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const node = audioCtx.createScriptProcessor(2048, 0, 1);
  const cyclesPerSample = CPU_HZ / SAMPLE_RATE;
  node.onaudioprocess = (e) => {
    const out = e.outputBuffer.getChannelData(0);
    const samples = apu.generateSamples(out.length, cyclesPerSample);
    out.set(samples);
  };
  node.connect(audioCtx.destination);
}

// Set up a fresh emulator for a loaded ROM and start running
function bootEmulator(rom: Uint8Array): void {
  memory = new Memory();
  memory.loadRom(rom);
  memory.connectJoypad(joypad);
  cpu = new CPU(memory);
  timer = new Timer(memory);
  ppu = new PPU(memory, cpu);
  apu = new APU(memory);
  setupAudio();

  // Register state as it would be right after the boot ROM runs
  cpu.a = 0x01; cpu.f = 0xb0;
  cpu.b = 0x00; cpu.c = 0x13;
  cpu.d = 0x00; cpu.e = 0xd8;
  cpu.h = 0x01; cpu.l = 0x4d;
  cpu.sp = 0xfffe;
  cpu.pc = 0x0100;

  running = true;
  requestAnimationFrame(frame);
}

// Run one frame's worth of cycles, driving CPU, timer, and PPU together
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

// Copy the PPU framebuffer to the canvas, scaled up
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

  const tmp = document.createElement("canvas");
  tmp.width = WIDTH;
  tmp.height = HEIGHT;
  tmp.getContext("2d")!.putImageData(image, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0, WIDTH * SCALE, HEIGHT * SCALE);
}

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  bootEmulator(new Uint8Array(buffer));
});

console.log("Game Boy emulator ready - pick a .gb ROM to run");