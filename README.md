# Game Boy Emulator

A Game Boy (DMG) emulator written from scratch in TypeScript, running in the browser. It boots and plays real games with graphics, sound, and keyboard controls, and its CPU passes all 11 of [Blargg's](https://github.com/retrio/gb-test-roms) `cpu_instrs` test ROMs.

## Features

- **CPU** — the complete Sharp LR35902 instruction set (~500 opcodes), passing all 11 Blargg `cpu_instrs` tests. Includes the interrupt system, the timer, `HALT`, and per-instruction cycle counting.
- **Graphics (PPU)** — background, window, and sprite rendering, driven by the correct mode-timing state machine. Handles the V-Blank and STAT interrupts, LYC=LY coincidence, palettes, scrolling, sprite flipping/priority, and 8x16 sprites.
- **Audio (APU)** — all four sound channels (two square, wave, noise) with volume envelopes, frequency sweep, length counters, and a frame sequencer, mixed through the NR50/51/52 control registers and played via the Web Audio API.
- **Input** — keyboard mapped to the joypad register.
- **Cartridge mappers** — no-mapper, MBC1, MBC2, MBC3 (with real-time clock), and MBC5, covering the large majority of the game library.
- **Save persistence** — battery-backed cartridge RAM is saved to the browser's `localStorage`, so game progress survives a reload.

## Verified against test ROMs

The CPU passes every sub-test in Blargg's `cpu_instrs` suite:

| # | Test | Status | # | Test | Status |
|---|------|--------|---|------|--------|
| 01 | special | ✅ | 07 | jr,jp,call,ret,rst | ✅ |
| 02 | interrupts | ✅ | 08 | misc instrs | ✅ |
| 03 | op sp,hl | ✅ | 09 | op r,r | ✅ |
| 04 | op r,imm | ✅ | 10 | bit ops | ✅ |
| 05 | op rp | ✅ | 11 | op a,(hl) | ✅ |
| 06 | ld r,r | ✅ | | | |

All 11 pass. The graphics pipeline also renders [dmg-acid2](https://github.com/mattcurrie/dmg-acid2) — a PPU test ROM designed to expose background, window, and sprite rendering bugs — correctly.

## Running it

```bash
npm install
npm run dev
```

Open the local URL Vite prints, click the file picker, and choose a `.gb` ROM. Blargg's test ROMs and dmg-acid2 are freely available and make good first tests.

**Controls:** arrow keys for the D-pad, `Z` = A, `X` = B, `Enter` = Start, `Shift` = Select. (Browsers block audio until you interact with the page, so click once to enable sound.)

## Architecture

The emulator is a set of components sharing one memory bus, driven by a single clock:

```
main.ts    -- the run loop, canvas rendering, and audio output
  |
  |- CPU    (cpu.ts)     fetch/decode/execute; returns cycles per instruction
  |- Timer  (timer.ts)   advances on those cycles; raises the timer interrupt
  |- PPU    (ppu.ts)     advances on those cycles; renders lines; raises V-Blank/STAT
  |- APU    (apu.ts)     generates audio samples from the sound registers
  |- Joypad (joypad.ts)  maps key state into the 0xFF00 register
  |- Memory (memory.ts)  the address space, cartridge mappers, DMA, and saves
```

The key design decision is that **`cpu.step()` returns the number of cycles each instruction took**, and the run loop feeds that same count to the timer and PPU. That keeps every subsystem advancing in lockstep on one clock, which is what makes games run at the right speed. The PPU and CPU are deliberately coupled through interrupts: the PPU *raises* V-Blank and STAT, and the CPU's dispatch *services* them — a running game syncs its logic to that heartbeat.

## Notable implementation details

A few problems that were more involved than they look:

- **Opcode-pattern decoding.** The load, ALU, and CB-prefixed instruction families are decoded from the bit structure of the opcode rather than written as ~500 individual cases, which mirrors how the hardware decodes and keeps the CPU compact.
- **Flag edge cases.** The half-carry flag is computed differently across instruction groups (bit 3 for 8-bit adds, bit 11 for `ADD HL,rr`, the low byte for `ADD SP,n`), and `DAA` depends on all of it being exactly right. Getting these correct is most of the work in a CPU core, and it's what the Blargg tests check.
- **HALT and interrupts.** `HALT` looks trivial but is fundamentally an interrupt instruction — it pauses the CPU until an interrupt is pending. Implementing it correctly was what made the interrupt test pass.
- **OAM DMA.** Sprites are loaded via a bulk DMA transfer triggered by a write to `0xFF46`. Without it, every sprite (menu cursors, player characters, falling pieces) is invisible — a bug found by running a real game and tracing why nothing moved.

## Tech stack

TypeScript, Vite, HTML Canvas, Web Audio API. No dependencies for the emulator core.
