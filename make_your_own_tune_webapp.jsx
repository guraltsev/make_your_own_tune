import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Sound Waves Presentation Mockup
 *
 * Fullscreen, presentation-friendly UI inspired by the attached sketch.
 *
 * Layout:
 * - Top title bar
 * - Two columns (1/3 left, 2/3 right)
 * - Left: 6 waveform tiles (2x3)
 * - Right: MODIFY (2/3 height) + PRODUCE (1/3 height)
 *
 * This is a mockup: it renders SVG wave previews and a simple timeline composer.
 */

// ----------------------------
// Wave math (simple, stable)
// ----------------------------

const TAU = Math.PI * 2;

type WaveType = "sine" | "triangle" | "square" | "saw" | "noise" | "humps";

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function fract(x: number) {
  return x - Math.floor(x);
}

function pseudoNoise01(x: number) {
  // Deterministic pseudo-noise in [0,1]
  // (Stable across renders; not cryptographic.)
  return fract(Math.sin(x * 127.1 + 311.7) * 43758.5453123);
}

function waveSample(type: WaveType, tSec: number, freqHz: number): number {
  const phase = TAU * freqHz * tSec;

  switch (type) {
    case "sine":
      return Math.sin(phase);

    case "square": {
      const s = Math.sin(phase);
      return s >= 0 ? 1 : -1;
    }

    case "triangle": {
      // Triangle via asin(sin): in [-1,1]
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    }

    case "saw": {
      // Sawtooth in [-1,1]
      // x = frac(f t) in [0,1); map to [-1,1)
      const x = fract(freqHz * tSec);
      return 2 * x - 1;
    }

    case "noise": {
      // Noise-like: sample pseudo-random at a rate tied to frequency
      // (Quantize time so it looks like a noisy signal rather than white noise.)
      const q = Math.floor(tSec * Math.max(40, freqHz * 0.6));
      const u = pseudoNoise01(q + 17.0);
      return 2 * u - 1;
    }

    case "humps": {
      // Two-hump envelope (visual variety): |sin| with mild smoothing
      const s = Math.abs(Math.sin(phase));
      // Shape it to emphasize peaks
      return 2 * Math.pow(s, 0.8) - 1;
    }

    default:
      return 0;
  }
}

function makeWavePath(opts: {
  type: WaveType;
  amp: number;
  freqHz: number;
  width: number;
  height: number;
  seconds: number;
  samples?: number;
  yPad?: number;
}) {
  const {
    type,
    amp,
    freqHz,
    width,
    height,
    seconds,
    samples = 220,
    yPad = 10,
  } = opts;

  const midY = height / 2;
  const usableH = height - 2 * yPad;

  // Assume amplitude in UI can exceed 1; map so it stays inside the plot.
  // We normalize against an expected max of 2.
  const a = clamp(amp, 0, 2);
  const scaleY = (usableH / 2) * (a / 2);

  let d = "";
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * width;
    const t = (i / samples) * seconds;
    const yVal = waveSample(type, t, freqHz);
    const y = midY - yVal * scaleY;
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

// ----------------------------
// UI model
// ----------------------------

type Slot =
  | {
      kind: "empty";
    }
  | {
      kind: "wave";
      type: WaveType;
      amp: number;
      freqHz: number;
      label: string;
    };

const WAVE_TILES: Array<{ type: WaveType; name: string; subtitle: string }> = [
  { type: "sine", name: "Sine", subtitle: "smooth" },
  { type: "triangle", name: "Triangle", subtitle: "linear ramps" },
  { type: "square", name: "Square", subtitle: "rich harmonics" },
  { type: "saw", name: "Sawtooth", subtitle: "bright" },
  { type: "noise", name: "Noise", subtitle: "random" },
  { type: "humps", name: "Humps", subtitle: "envelope" },
];

function formatHz(x: number) {
  if (x >= 1000) return `${(x / 1000).toFixed(2)} kHz`;
  return `${Math.round(x)} Hz`;
}

function timeLabelForSlot(i: number) {
  const start = i * 2;
  const end = start + 2;
  return `${start}–${end}s`;
}

// ----------------------------
// Main component
// ----------------------------

export default function SoundWavesPresentationMockup() {
  const [title, setTitle] = useState("Math of Sound Waves");
  const [waveType, setWaveType] = useState<WaveType>("sine");
  const [amp, setAmp] = useState(1.0);
  const [freqHz, setFreqHz] = useState(220);

  // ----------------------------
  // Audio (continuous synth with smooth parameter updates)
  // ----------------------------
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletReadyRef = useRef<Promise<void> | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingParamsRef = useRef<{ freqHz: number; amp: number; waveType: WaveType } | null>(null);

  const [playing, setPlaying] = useState<null | "base" | "modified">(null);

  const ensureAudioContext = useCallback(async () => {
    if (!audioCtxRef.current) {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const ensureWorklet = useCallback(async (ctx: AudioContext) => {
    if (!workletReadyRef.current) {
      // Inline AudioWorklet (self-contained) to maintain continuous phase and smooth parameter updates.
      const workletCode = `
        const TAU = Math.PI * 2;

        function clamp(x, lo, hi) {
          return Math.max(lo, Math.min(hi, x));
        }

        class WaveSynthProcessor extends AudioWorkletProcessor {
          constructor() {
            super();

            // Continuous phase
            this.phase = 0;

            // Smoothed params
            this.currentFreq = 220;
            this.targetFreq = 220;
            this.currentAmp = 0;
            this.targetAmp = 0;

            // Wave crossfade (to reduce clicks on wave shape change)
            this.waveA = 'sine';
            this.waveB = 'sine';
            this.mix = 1; // 1 -> fully waveB

            // Noise state
            this.rng = 1 >>> 0;
            this.noiseHold = 0;
            this.noiseCounter = 0;
            this.noiseHoldN = Math.max(1, Math.floor(sampleRate / 3500));

            this.port.onmessage = (e) => {
              const m = (e && e.data) ? e.data : {};
              if (m.type !== 'params') return;

              if (typeof m.freqHz === 'number' && isFinite(m.freqHz)) {
                this.targetFreq = Math.max(0, m.freqHz);
              }

              if (typeof m.amp === 'number' && isFinite(m.amp)) {
                // UI amp range is [0,2]. Convert to safe gain in [0,0.65].
                const a = clamp(m.amp, 0, 2);
                this.targetAmp = 0.65 * (a / 2);
              }

              if (typeof m.waveType === 'string') {
                const w = m.waveType;
                if (w !== this.waveB) {
                  this.waveA = this.waveB;
                  this.waveB = w;
                  this.mix = 0;
                }
              }
            };
          }

          _nextNoise() {
            // LCG pseudo-random; sample-and-hold to avoid excessive harshness.
            if (this.noiseCounter++ >= this.noiseHoldN) {
              this.noiseCounter = 0;
              this.rng = (1664525 * this.rng + 1013904223) >>> 0;
              const u = this.rng / 4294967296;
              this.noiseHold = 2 * u - 1;
            }
            return this.noiseHold;
          }

          _sampleWave(wave, phase) {
            switch (wave) {
              case 'sine':
                return Math.sin(phase);
              case 'square':
                return Math.sin(phase) >= 0 ? 1 : -1;
              case 'triangle':
                return (2 / Math.PI) * Math.asin(Math.sin(phase));
              case 'saw': {
                // phase in [0, TAU): map to [-1,1)
                const x = phase / TAU;
                return 2 * x - 1;
              }
              case 'humps': {
                const s = Math.abs(Math.sin(phase));
                return 2 * Math.pow(s, 0.8) - 1;
              }
              case 'noise':
                return this._nextNoise();
              default:
                return Math.sin(phase);
            }
          }

          process(inputs, outputs) {
            const out = outputs[0][0];
            const sr = sampleRate;

            // Time constants (seconds). Small but nonzero to avoid clicks.
            const tcFreq = 0.010;
            const tcAmp = 0.006;
            const tcWave = 0.015;

            const kFreq = 1 - Math.exp(-1 / (sr * tcFreq));
            const kAmp = 1 - Math.exp(-1 / (sr * tcAmp));
            const kWave = 1 - Math.exp(-1 / (sr * tcWave));

            for (let i = 0; i < out.length; i++) {
              // Smooth parameters
              this.currentFreq += (this.targetFreq - this.currentFreq) * kFreq;
              this.currentAmp += (this.targetAmp - this.currentAmp) * kAmp;
              this.mix += (1 - this.mix) * kWave;

              // Continuous phase advance
              const dphi = TAU * (this.currentFreq / sr);
              this.phase += dphi;
              if (this.phase >= TAU) {
                this.phase -= TAU * Math.floor(this.phase / TAU);
              }

              // Crossfade between waveA and waveB during shape changes
              const a = this._sampleWave(this.waveA, this.phase);
              const b = this._sampleWave(this.waveB, this.phase);
              const s = (1 - this.mix) * a + this.mix * b;

              out[i] = s * this.currentAmp;
            }

            return true;
          }
        }

        registerProcessor('wave-synth', WaveSynthProcessor);
      `;

      const blob = new Blob([workletCode], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      workletReadyRef.current = ctx.audioWorklet.addModule(url).finally(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
    }

    await workletReadyRef.current;
  }, []);

  const ensureSynthNode = useCallback(async () => {
    const ctx = await ensureAudioContext();
    await ensureWorklet(ctx);

    if (!workletNodeRef.current) {
      const node = new AudioWorkletNode(ctx, "wave-synth", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });

      const g = ctx.createGain();
      // Start silent; ramp up when playback begins.
      g.gain.setValueAtTime(0.0001, ctx.currentTime);

      node.connect(g);
      g.connect(ctx.destination);

      workletNodeRef.current = node;
      masterGainRef.current = g;
    }

    return ctx;
  }, [ensureAudioContext, ensureWorklet]);

  const postParamsNow = useCallback((p: { freqHz: number; amp: number; waveType: WaveType }) => {
    workletNodeRef.current?.port.postMessage({ type: "params", ...p });
  }, []);

  const scheduleParams = useCallback((p: { freqHz: number; amp: number; waveType: WaveType }) => {
    pendingParamsRef.current = p;
    if (rafRef.current != null) return;

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const q = pendingParamsRef.current;
      if (!q || !workletNodeRef.current) return;
      workletNodeRef.current.port.postMessage({ type: "params", ...q });
    });
  }, []);

  const stopPlayback = useCallback(() => {
    if (stopTimerRef.current != null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    const ctx = audioCtxRef.current;
    const g = masterGainRef.current;

    if (ctx && g) {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(0.0001, now, 0.02);
    }

    // Disconnect shortly after fade.
    window.setTimeout(() => {
      try {
        workletNodeRef.current?.disconnect();
      } catch {
        // ignore
      }
      try {
        masterGainRef.current?.disconnect();
      } catch {
        // ignore
      }
      workletNodeRef.current = null;
      masterGainRef.current = null;
      setPlaying(null);
    }, 80);
  }, []);

  const playVariant = useCallback(
    async (variant: "base" | "modified") => {
      if (stopTimerRef.current != null) {
        window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }

      const ctx = await ensureSynthNode();
      const g = masterGainRef.current;

      // Prepare params for the chosen variant.
      const params =
        variant === "base"
          ? { freqHz: 220, amp: 1.0, waveType }
          : { freqHz, amp, waveType };

      // Switching between base/modified: quick gain dip to mask abrupt change.
      if (g) {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        if (playing && playing !== variant) {
          g.gain.setValueAtTime(1.0, now);
          g.gain.linearRampToValueAtTime(0.0001, now + 0.01);
          window.setTimeout(() => postParamsNow(params), 10);
          g.gain.linearRampToValueAtTime(1.0, now + 0.03);
        } else {
          g.gain.setValueAtTime(0.0001, now);
          postParamsNow(params);
          g.gain.linearRampToValueAtTime(1.0, now + 0.03);
        }
      } else {
        postParamsNow(params);
      }

      setPlaying(variant);

      // Auto-stop after 2 seconds.
      stopTimerRef.current = window.setTimeout(() => {
        stopPlayback();
      }, 2000);
    },
    [amp, ensureSynthNode, freqHz, playing, postParamsNow, stopPlayback, waveType]
  );

  // While playing, reflect slider and wave-shape changes immediately.
  useEffect(() => {
    if (!playing) return;
    const p = playing === "base" ? { freqHz: 220, amp: 1.0, waveType } : { freqHz, amp, waveType };
    scheduleParams(p);
  }, [playing, waveType, amp, freqHz, scheduleParams]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try {
        if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      } catch {
        // ignore
      }
      stopPlayback();
    };
  }, [stopPlayback]);

  const baseStrokeWidth = playing === "base" ? 6 : 4;
  const modifiedStrokeWidth = playing === "modified" ? 6 : 4;

  const [slots, setSlots] = useState<Slot[]>([...Array(5)].map(() => ({ kind: "empty" })));


  const basePath = useMemo(() => {
    return makeWavePath({
      type: waveType,
      amp: 1,
      freqHz: 220,
      width: 760,
      height: 280,
      seconds: 0.02,
      samples: 320,
      yPad: 14,
    });
  }, [waveType]);

  const modifiedPath = useMemo(() => {
    return makeWavePath({
      type: waveType,
      amp,
      freqHz,
      width: 760,
      height: 280,
      seconds: 0.02,
      samples: 320,
      yPad: 14,
    });
  }, [waveType, amp, freqHz]);

  function placeInSlot(i: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = {
        kind: "wave",
        type: waveType,
        amp,
        freqHz,
        label: `${WAVE_TILES.find((w) => w.type === waveType)?.name ?? waveType} · ${formatHz(freqHz)}`,
      };
      return next;
    });
  }

  function clearTimeline() {
    setSlots([...Array(5)].map(() => ({ kind: "empty" })));
  }

  return (
    <div className="h-screen w-screen bg-slate-50 text-slate-900">
      {/* Title bar */}
      <div className="h-16 px-6 flex items-center justify-between border-b bg-white">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-sm font-semibold">
            Ω
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-slate-500">Presentation Mode</div>
            <div className="text-xl font-semibold leading-tight truncate">{title}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="hidden md:block w-[360px] rounded-xl border bg-slate-50 px-3 py-2 text-sm"
            placeholder="Title"
          />
          <div className="text-xs text-slate-500 hidden lg:block">Select → Modify → Produce</div>
        </div>
      </div>

      {/* Main */}
      <div className="h-[calc(100vh-4rem)] w-full flex">
        {/* Left column (1/3) */}
        <div className="w-1/3 min-w-[360px] border-r bg-white p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">1) Pick a wave</div>
              <div className="text-lg font-semibold">Wave Library</div>
            </div>
            <div className="text-xs text-slate-500">6 tiles</div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            {WAVE_TILES.map((w) => {
              const selected = w.type === waveType;
              const tilePath = makeWavePath({
                type: w.type,
                amp: 1,
                freqHz: 4,
                width: 160,
                height: 90,
                seconds: 1,
                samples: 120,
                yPad: 10,
              });
              return (
                <button
                  key={w.type}
                  onClick={() => setWaveType(w.type)}
                  className={
                    "rounded-2xl border p-3 text-left shadow-sm transition " +
                    (selected
                      ? "border-slate-900 ring-2 ring-slate-900/10 bg-slate-50"
                      : "border-slate-200 hover:border-slate-300 bg-white")
                  }
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{w.name}</div>
                      <div className="text-xs text-slate-500">{w.subtitle}</div>
                    </div>
                    <div
                      className={
                        "text-[10px] px-2 py-1 rounded-full border " +
                        (selected ? "border-slate-900 text-slate-900" : "border-slate-200 text-slate-500")
                      }
                    >
                      {selected ? "Selected" : "Pick"}
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl bg-white border overflow-hidden">
                    <svg width="100%" height="90" viewBox="0 0 160 90" className="block">
                      <path d={tilePath} fill="none" stroke="currentColor" strokeWidth="3" className="text-slate-800" />
                      <line x1="0" y1="45" x2="160" y2="45" className="stroke-slate-200" strokeWidth="1" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Tip</div>
            <div className="text-sm mt-1">
              Pick a waveform on the left, then use amplitude and frequency on the right to show how it changes.
            </div>
          </div>
        </div>

        {/* Right column (2/3) */}
        <div className="w-2/3 flex flex-col">
          {/* MODIFY (2/3 height) */}
          <div className="flex-[2] p-5">
            <div className="h-full rounded-3xl border bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">2) Modify</div>
                  <div className="text-lg font-semibold">Wave Inspector</div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500">Base: 220 Hz, amp 1</div>
                  <div className="h-2 w-2 rounded-full bg-slate-900" title="Modified" />
                  <div className="text-xs text-slate-600">Modified</div>
                  <div className="h-2 w-2 rounded-full bg-slate-300" title="Base" />
                  <div className="text-xs text-slate-500">Base</div>
                </div>
              </div>

              <div className="flex-1 flex min-h-0">
                {/* Plot */}
                <div className="flex-1 p-6 min-w-0">
                  <div className="h-full rounded-2xl border bg-slate-50 p-4 flex flex-col">
                    <div className="text-sm font-medium flex items-center justify-between">
                      <span>
                        {WAVE_TILES.find((w) => w.type === waveType)?.name ?? waveType} · {formatHz(freqHz)} · amp {amp.toFixed(2)}
                      </span>
                      <span className="text-xs text-slate-500">window: 20 ms</span>
                    </div>

                    <div className="mt-3 flex-1 min-h-0 rounded-xl bg-white border overflow-hidden">
                      <svg
                        viewBox="0 0 760 280"
                        className="w-full h-full block"
                        preserveAspectRatio="none"
                        aria-label="Wave plot"
                      >
                        {/* axes */}
                        <line x1="0" y1="140" x2="760" y2="140" stroke="rgb(226,232,240)" strokeWidth="2" />
                        <line x1="40" y1="0" x2="40" y2="280" stroke="rgb(226,232,240)" strokeWidth="2" />

                        {/* base */}
                        <path
                          d={basePath}
                          fill="none"
                          stroke="rgb(203,213,225)"
                          strokeWidth={baseStrokeWidth}
                        />
                        <path
                          d={basePath}
                          fill="none"
                          stroke="rgba(0,0,0,0)"
                          strokeWidth="16"
                          style={{ cursor: "pointer" }}
                          pointerEvents="stroke"
                          onClick={() => playVariant("base")}
                        />

                        {/* modified */}
                        <path
                          d={modifiedPath}
                          fill="none"
                          stroke="rgb(15,23,42)"
                          strokeWidth={modifiedStrokeWidth}
                        />
                        <path
                          d={modifiedPath}
                          fill="none"
                          stroke="rgba(0,0,0,0)"
                          strokeWidth="16"
                          style={{ cursor: "pointer" }}
                          pointerEvents="stroke"
                          onClick={() => playVariant("modified")}
                        />

                        {/* labels */}
                        <text x="48" y="20" fontSize="12" fill="rgb(100,116,139)">Amplitude</text>
                        <text x="690" y="268" fontSize="12" fill="rgb(100,116,139)">time</text>
                      </svg>
                    </div>

                    <div className="mt-3 text-xs text-slate-500">
                      This plot overlays a base wave (220 Hz, amp 1) with the modified wave (current sliders). Click either curve to play a 2-second tone; clicking the other curve stops the current sound and switches.
                    </div>
                  </div>
                </div>

                {/* Sliders */}
                <div className="w-[320px] border-l p-6 bg-white">
                  <div className="text-sm font-semibold">Controls</div>

                  <div className="mt-4 space-y-5">
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">Amplitude</div>
                        <div className="text-sm tabular-nums">{amp.toFixed(2)}</div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.01}
                        value={amp}
                        onChange={(e) => setAmp(parseFloat(e.target.value))}
                        className="mt-3 w-full"
                      />
                      <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                        <span>0</span>
                        <span>2</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">Frequency</div>
                        <div className="text-sm tabular-nums">{formatHz(freqHz)}</div>
                      </div>
                      <input
                        type="range"
                        min={40}
                        max={2000}
                        step={1}
                        value={freqHz}
                        onChange={(e) => setFreqHz(parseInt(e.target.value, 10))}
                        className="mt-3 w-full"
                      />
                      <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                        <span>40 Hz</span>
                        <span>2 kHz</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => setFreqHz(220)}
                          className="flex-1 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                        >
                          Reset to 220 Hz
                        </button>
                        <button
                          onClick={() => {
                            setAmp(1.0);
                            setFreqHz(220);
                          }}
                          className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                        >
                          Reset all
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border p-4">
                      <div className="text-xs uppercase tracking-wider text-slate-500">Current selection</div>
                      <div className="mt-1 font-semibold">
                        {WAVE_TILES.find((w) => w.type === waveType)?.name ?? waveType}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">{formatHz(freqHz)} · amp {amp.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* PRODUCE (1/3 height) */}
          <div className="flex-[1] p-5 pt-0">
            <div className="h-full rounded-3xl border bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">3) Produce</div>
                  <div className="text-lg font-semibold">10-second Timeline</div>
                </div>

                <button
                  onClick={clearTimeline}
                  className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>

              <div className="flex-1 p-6 flex flex-col min-h-0">
                {/* timeline bar */}
                <div className="grid grid-cols-5 gap-3 min-h-0">
                  {slots.map((slot, i) => {
                    const label = timeLabelForSlot(i);
                    const filled = slot.kind === "wave";
                    const miniPath = filled
                      ? makeWavePath({
                          type: slot.type,
                          amp: slot.amp,
                          freqHz: slot.freqHz,
                          width: 220,
                          height: 80,
                          seconds: 0.02,
                          samples: 120,
                          yPad: 10,
                        })
                      : null;

                    return (
                      <div key={i} className="flex flex-col min-h-0">
                        <div
                          className={
                            "flex-1 rounded-2xl border p-3 bg-slate-50 flex flex-col min-h-0 " +
                            (filled ? "border-slate-300" : "border-dashed border-slate-300")
                          }
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-xs uppercase tracking-wider text-slate-500">Slot {i + 1}</div>
                            <div className="text-xs text-slate-500 tabular-nums">{label}</div>
                          </div>

                          <div className="mt-2 rounded-xl bg-white border flex-1 min-h-0 overflow-hidden">
                            {filled ? (
                              <svg viewBox="0 0 220 80" className="w-full h-full block" preserveAspectRatio="none">
                                <line x1="0" y1="40" x2="220" y2="40" stroke="rgb(226,232,240)" strokeWidth="2" />
                                <path d={miniPath!} fill="none" stroke="rgb(15,23,42)" strokeWidth="3" />
                              </svg>
                            ) : (
                              <div className="h-full w-full flex items-center justify-center text-xs text-slate-400">
                                empty
                              </div>
                            )}
                          </div>

                          <div className="mt-2 text-xs text-slate-600 truncate">
                            {filled ? slot.label : "—"}
                          </div>
                        </div>

                        <button
                          onClick={() => placeInSlot(i)}
                          className="mt-2 rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800"
                        >
                          Add here
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  Each slot is a 2-second region (total 10 seconds). “Add here” copies the current modified wave (type, amplitude,
                  frequency) into that slot.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
