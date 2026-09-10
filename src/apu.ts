import { Memory } from "./memory";

// Game Boy APU: two square channels, a wave channel, and a noise channel,

const DUTY_PATTERNS = [
  [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
  [1, 0, 0, 0, 0, 0, 0, 1], // 25%
  [1, 0, 0, 0, 0, 1, 1, 1], // 50%
  [0, 1, 1, 1, 1, 1, 1, 0], // 75%
];

// A square channel with volume envelope and (channel 1 only) frequency sweep
class SquareChannel {
  enabled = false;
  private dutyIndex = 0;
  private dutyStep = 0;
  private freqTimer = 0;
  frequency = 0;

  private volume = 0;
  private startVolume = 0;
  private envPeriod = 0;
  private envDirection = 0;
  private envTimer = 0;
  private lastEnvByte = -1;

  private lengthCounter = 0;
  private lengthEnabled = false;

  private hasSweep: boolean;
  private sweepPeriod = 0;
  private sweepShift = 0;
  private sweepDirection = 0;
  private sweepTimer = 0;
  private sweepEnabled = false;

  constructor(hasSweep: boolean) {
    this.hasSweep = hasSweep;
  }

  setDuty(duty: number): void {
    this.dutyIndex = duty & 3;
  }

  // Configure envelope params. Only reset the live volume when the register
  // actually changes, so the running envelope isn't wiped every refresh
  setEnvelope(value: number): void {
    this.startVolume = (value >> 4) & 0x0f;
    this.envDirection = (value & 0x08) ? 1 : -1;
    this.envPeriod = value & 0x07;
    if (value !== this.lastEnvByte) {
      this.lastEnvByte = value;
      this.volume = this.startVolume;
      this.envTimer = this.envPeriod;
    }
    if ((value & 0xf8) === 0) this.enabled = false; // DAC off
  }

  setSweep(value: number): void {
    this.sweepPeriod = (value >> 4) & 0x07;
    this.sweepDirection = (value & 0x08) ? -1 : 1;
    this.sweepShift = value & 0x07;
  }

  setLength(value: number): void {
    this.lengthCounter = 64 - (value & 0x3f);
  }

  // A write to NRx4 with bit 7 set restarts the channel
  trigger(lengthEnabled: boolean): void {
    this.enabled = true;
    if (this.lengthCounter === 0) this.lengthCounter = 64;
    this.lengthEnabled = lengthEnabled;
    this.volume = this.startVolume;
    this.envTimer = this.envPeriod;
    if (this.hasSweep) {
      this.sweepTimer = this.sweepPeriod;
      this.sweepEnabled = this.sweepPeriod > 0 || this.sweepShift > 0;
    }
  }

  clockLength(): void {
    if (this.lengthEnabled && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) this.enabled = false;
    }
  }

  clockEnvelope(): void {
    if (this.envPeriod === 0) return;
    if (this.envTimer > 0) this.envTimer--;
    if (this.envTimer === 0) {
      this.envTimer = this.envPeriod;
      const next = this.volume + this.envDirection;
      if (next >= 0 && next <= 15) this.volume = next;
    }
  }

  clockSweep(): void {
    if (!this.hasSweep || !this.sweepEnabled) return;
    if (this.sweepTimer > 0) this.sweepTimer--;
    if (this.sweepTimer === 0) {
      this.sweepTimer = this.sweepPeriod > 0 ? this.sweepPeriod : 8;
      if (this.sweepShift > 0) {
        const delta = (this.frequency >> this.sweepShift) * this.sweepDirection;
        const next = this.frequency + delta;
        if (next > 2047) this.enabled = false;
        else if (next >= 0) this.frequency = next;
      }
    }
  }

  tick(): number {
    if (this.freqTimer <= 0) {
      this.freqTimer = (2048 - this.frequency) * 4;
      this.dutyStep = (this.dutyStep + 1) & 7;
    }
    this.freqTimer--;

    if (!this.enabled) return 0;
    const bit = DUTY_PATTERNS[this.dutyIndex][this.dutyStep];
    return (bit ? 1 : -1) * (this.volume / 15);
  }
}

// Channel 3: plays a 32-sample waveform stored in wave RAM (0xFF30-0xFF3F)
class WaveChannel {
  enabled = false;
  frequency = 0;
  private freqTimer = 0;
  private position = 0;
  private volumeShift = 0; // 0=mute, 1=full, 2=half, 3=quarter
  private lengthCounter = 0;
  private lengthEnabled = false;
  private samples = new Uint8Array(32);

  setVolume(code: number): void {
    this.volumeShift = (code >> 5) & 0x03;
  }

  setLength(value: number): void {
    this.lengthCounter = 256 - value;
  }

  loadWaveRam(bytes: Uint8Array): void {
    for (let i = 0; i < 16; i++) {
      this.samples[i * 2] = (bytes[i] >> 4) & 0x0f;
      this.samples[i * 2 + 1] = bytes[i] & 0x0f;
    }
  }

  trigger(lengthEnabled: boolean): void {
    this.enabled = true;
    if (this.lengthCounter === 0) this.lengthCounter = 256;
    this.lengthEnabled = lengthEnabled;
    this.position = 0;
  }

  clockLength(): void {
    if (this.lengthEnabled && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) this.enabled = false;
    }
  }

  tick(): number {
    if (this.freqTimer <= 0) {
      this.freqTimer = (2048 - this.frequency) * 2;
      this.position = (this.position + 1) & 31;
    }
    this.freqTimer--;

    if (!this.enabled || this.volumeShift === 0) return 0;
    let sample = this.samples[this.position];
    sample >>= (this.volumeShift - 1);
    return (sample / 7.5) - 1;
  }
}

// Channel 4: pseudo-random noise from a linear-feedback shift register
class NoiseChannel {
  enabled = false;
  private lfsr = 0x7fff;
  private freqTimer = 0;
  private divisor = 8;
  private shiftClock = 0;
  private widthMode = false;
  private volume = 0;
  private startVolume = 0;
  private envPeriod = 0;
  private envDirection = 0;
  private envTimer = 0;
  private lastEnvByte = -1;
  private lengthCounter = 0;
  private lengthEnabled = false;

  private static DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112];

  setEnvelope(value: number): void {
    this.startVolume = (value >> 4) & 0x0f;
    this.envDirection = (value & 0x08) ? 1 : -1;
    this.envPeriod = value & 0x07;
    if (value !== this.lastEnvByte) {
      this.lastEnvByte = value;
      this.volume = this.startVolume;
      this.envTimer = this.envPeriod;
    }
    if ((value & 0xf8) === 0) this.enabled = false;
  }

  setPolynomial(value: number): void {
    this.shiftClock = (value >> 4) & 0x0f;
    this.widthMode = (value & 0x08) !== 0;
    this.divisor = NoiseChannel.DIVISORS[value & 0x07];
  }

  setLength(value: number): void {
    this.lengthCounter = 64 - (value & 0x3f);
  }

  trigger(lengthEnabled: boolean): void {
    this.enabled = true;
    if (this.lengthCounter === 0) this.lengthCounter = 64;
    this.lengthEnabled = lengthEnabled;
    this.volume = this.startVolume;
    this.envTimer = this.envPeriod;
    this.lfsr = 0x7fff;
  }

  clockLength(): void {
    if (this.lengthEnabled && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) this.enabled = false;
    }
  }

  clockEnvelope(): void {
    if (this.envPeriod === 0) return;
    if (this.envTimer > 0) this.envTimer--;
    if (this.envTimer === 0) {
      this.envTimer = this.envPeriod;
      const next = this.volume + this.envDirection;
      if (next >= 0 && next <= 15) this.volume = next;
    }
  }

  tick(): number {
    if (this.freqTimer <= 0) {
      this.freqTimer = this.divisor << this.shiftClock;
      const xor = (this.lfsr & 1) ^ ((this.lfsr >> 1) & 1);
      this.lfsr >>= 1;
      this.lfsr |= xor << 14;
      if (this.widthMode) {
        this.lfsr &= ~0x40;
        this.lfsr |= xor << 6;
      }
    }
    this.freqTimer--;

    if (!this.enabled) return 0;
    const bit = (~this.lfsr) & 1;
    return (bit ? 1 : -1) * (this.volume / 15);
  }
}

const FRAME_SEQ_PERIOD = 8192; // CPU cycles per frame-sequencer step (512Hz)

export class APU {
  private memory: Memory;
  private ch1 = new SquareChannel(true);
  private ch2 = new SquareChannel(false);
  private ch3 = new WaveChannel();
  private ch4 = new NoiseChannel();

  private frameSeqTimer = FRAME_SEQ_PERIOD;
  private frameSeqStep = 0;

  constructor(memory: Memory) {
    this.memory = memory;
  }

  // Re-read all sound registers and push their values into the channels
  private refresh(): void {
    this.ch1.setSweep(this.memory.read(0xff10));
    this.ch1.setDuty(this.memory.read(0xff11) >> 6);
    this.ch1.setLength(this.memory.read(0xff11));
    this.ch1.setEnvelope(this.memory.read(0xff12));
    this.ch1.frequency = ((this.memory.read(0xff14) & 0x07) << 8) | this.memory.read(0xff13);
    if (this.memory.read(0xff14) & 0x80) {
      this.ch1.trigger((this.memory.read(0xff14) & 0x40) !== 0);
      this.memory.write(0xff14, this.memory.read(0xff14) & 0x7f);
    }

    this.ch2.setDuty(this.memory.read(0xff16) >> 6);
    this.ch2.setLength(this.memory.read(0xff16));
    this.ch2.setEnvelope(this.memory.read(0xff17));
    this.ch2.frequency = ((this.memory.read(0xff19) & 0x07) << 8) | this.memory.read(0xff18);
    if (this.memory.read(0xff19) & 0x80) {
      this.ch2.trigger((this.memory.read(0xff19) & 0x40) !== 0);
      this.memory.write(0xff19, this.memory.read(0xff19) & 0x7f);
    }

    this.ch3.setLength(this.memory.read(0xff1b));
    this.ch3.setVolume(this.memory.read(0xff1c));
    this.ch3.frequency = ((this.memory.read(0xff1e) & 0x07) << 8) | this.memory.read(0xff1d);
    const wave = new Uint8Array(16);
    for (let i = 0; i < 16; i++) wave[i] = this.memory.read(0xff30 + i);
    this.ch3.loadWaveRam(wave);
    if (this.memory.read(0xff1e) & 0x80) {
      this.ch3.trigger((this.memory.read(0xff1e) & 0x40) !== 0);
      this.memory.write(0xff1e, this.memory.read(0xff1e) & 0x7f);
    }

    this.ch4.setLength(this.memory.read(0xff20));
    this.ch4.setEnvelope(this.memory.read(0xff21));
    this.ch4.setPolynomial(this.memory.read(0xff22));
    if (this.memory.read(0xff23) & 0x80) {
      this.ch4.trigger((this.memory.read(0xff23) & 0x40) !== 0);
      this.memory.write(0xff23, this.memory.read(0xff23) & 0x7f);
    }
  }

  // Step the frame sequencer: length 256Hz, envelope 64Hz, sweep 128Hz
  private stepFrameSequencer(): void {
    switch (this.frameSeqStep) {
      case 0: this.clockLengths(); break;
      case 2: this.clockLengths(); this.clockSweeps(); break;
      case 4: this.clockLengths(); break;
      case 6: this.clockLengths(); this.clockSweeps(); break;
      case 7: this.clockEnvelopes(); break;
    }
    this.frameSeqStep = (this.frameSeqStep + 1) & 7;
  }

  private clockLengths(): void {
    this.ch1.clockLength();
    this.ch2.clockLength();
    this.ch3.clockLength();
    this.ch4.clockLength();
  }

  private clockEnvelopes(): void {
    this.ch1.clockEnvelope();
    this.ch2.clockEnvelope();
    this.ch4.clockEnvelope();
  }

  private clockSweeps(): void {
    this.ch1.clockSweep();
  }

  // Generate `count` mixed samples at the given cycles-per-sample rate
  generateSamples(count: number, cyclesPerSample: number): Float32Array {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.refresh();

      // NR52 bit 7: master sound switch. When off, output is silent
      const nr52 = this.memory.read(0xff26);
      if ((nr52 & 0x80) === 0) {
        // Advance the clock but emit silence
        for (let c = 0; c < cyclesPerSample; c++) {
          this.frameSeqTimer--;
          if (this.frameSeqTimer <= 0) {
            this.frameSeqTimer = FRAME_SEQ_PERIOD;
            this.stepFrameSequencer();
          }
        }
        out[i] = 0;
        continue;
      }

      // NR51: routes each channel to left/right. We sum to mono, so a channel
      // counts if it is enabled to either output
      const nr51 = this.memory.read(0xff25);
      const ch1On = (nr51 & 0x11) !== 0;
      const ch2On = (nr51 & 0x22) !== 0;
      const ch3On = (nr51 & 0x44) !== 0;
      const ch4On = (nr51 & 0x88) !== 0;

      // NR50: master volume per output (0-7 each). Use the louder side for mono
      const nr50 = this.memory.read(0xff24);
      const leftVol = (nr50 >> 4) & 0x07;
      const rightVol = nr50 & 0x07;
      const masterVol = Math.max(leftVol, rightVol) / 7;

      let sample = 0;
      for (let c = 0; c < cyclesPerSample; c++) {
        this.frameSeqTimer--;
        if (this.frameSeqTimer <= 0) {
          this.frameSeqTimer = FRAME_SEQ_PERIOD;
          this.stepFrameSequencer();
        }
        // Tick every channel so timers keep running, but only mix routed ones
        const s1 = this.ch1.tick();
        const s2 = this.ch2.tick();
        const s3 = this.ch3.tick();
        const s4 = this.ch4.tick();
        sample =
          (ch1On ? s1 : 0) +
          (ch2On ? s2 : 0) +
          (ch3On ? s3 : 0) +
          (ch4On ? s4 : 0);
      }
      out[i] = sample * 0.15 * masterVol;
    }
    return out;
  }
}