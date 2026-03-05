import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
const PREVIEW_PERIODS = 3;
const BASE_FREQUENCY_HZ = 220;
const INSPECTOR_SCROLL_GRAPHS_PER_SECOND = 1;
const PLAYBACK_FADE_SECONDS = 0.2;

type WaveType = "sine" | "triangle" | "square" | "saw" | "custom" | "humps";
const CUSTOM_MODE_COUNT = 15;

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function fract(x: number) {
  return x - Math.floor(x);
}

const DEFAULT_CUSTOM_MODES = [1, ...Array(CUSTOM_MODE_COUNT - 1).fill(0)] as number[];

function normalizeModes(modes: number[]) {
  const totalMagnitude = modes.reduce((acc, value) => acc + Math.abs(value), 0);
  if (totalMagnitude === 0) return [...DEFAULT_CUSTOM_MODES];
  return modes.map((value) => value / totalMagnitude);
}

function getBipolarSliderBackground(value: number, fillColor: string) {
  const trackColor = "rgb(226,232,240)";
  const clamped = clamp(value, -1, 1);
  const pointPercent = ((clamped + 1) / 2) * 100;

  if (pointPercent >= 50) {
    return `linear-gradient(to right, ${trackColor} 0%, ${trackColor} 50%, ${fillColor} 50%, ${fillColor} ${pointPercent}%, ${trackColor} ${pointPercent}%, ${trackColor} 100%)`;
  }

  return `linear-gradient(to right, ${trackColor} 0%, ${trackColor} ${pointPercent}%, ${fillColor} ${pointPercent}%, ${fillColor} 50%, ${trackColor} 50%, ${trackColor} 100%)`;
}

function getModeColor(modeIndex: number) {
  const t = clamp(modeIndex / (CUSTOM_MODE_COUNT - 1), 0, 1);
  const hue = 0 + t * 220;
  return `hsl(${hue.toFixed(1)} 85% 52%)`;
}

function waveSample(type: WaveType, tSec: number, freqHz: number, customModes?: number[]): number {
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

    case "custom": {
      const modes = customModes ?? [];
      let sum = 0;
      for (let i = 0; i < CUSTOM_MODE_COUNT; i++) {
        const weight = modes[i] ?? 0;
        if (weight === 0) continue;
        sum += weight * Math.sin(phase * (i + 1));
      }
      return clamp(sum, -1, 1);
    }

    case "humps": {
      // Two-hump envelope (visual variety): |sin| with mild smoothing.
      // Use half-phase so it oscillates one octave lower than before.
      const s = Math.abs(Math.sin(phase * 0.5));
      // Shape it to emphasize peaks
      return 2 * Math.pow(s, 0.8) - 1;
    }

    default:
      return 0;
  }
}

function secondsForPeriods(freqHz: number, periods = PREVIEW_PERIODS) {
  const safeFreq = Math.max(freqHz, 1e-6);
  return periods / safeFreq;
}

function makeWavePath(opts: {
  type: WaveType;
  amp: number;
  freqHz: number;
  customModes?: number[];
  width: number;
  height: number;
  seconds: number;
  timeOffsetSec?: number;
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
    timeOffsetSec = 0,
    samples = 220,
    yPad = 10,
    customModes,
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
    const t = timeOffsetSec + (i / samples) * seconds;
    const yVal = waveSample(type, t, freqHz, customModes);
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
      customModes?: number[];
      label: string;
    };

type TimelineSlot = {
  id: number;
  slot: Slot;
  weight: number;
};

const TIMELINE_TOTAL_SECONDS = 10;
const MIN_TIMELINE_NOTES = 2;
const DEFAULT_TIMELINE_NOTES = 3;
const MAX_TIMELINE_NOTES = 15;
const MIN_SLOT_WEIGHT = 0.5;
const MAX_SLOT_WEIGHT = 6;

const WAVE_TILES: Array<{ type: WaveType; name: string; subtitle: string }> = [
  { type: "sine", name: "Sine", subtitle: "smooth" },
  { type: "triangle", name: "Triangle", subtitle: "linear ramps" },
  { type: "square", name: "Square", subtitle: "rich harmonics" },
  { type: "saw", name: "Sawtooth", subtitle: "bright" },
  { type: "custom", name: "Custom", subtitle: `${CUSTOM_MODE_COUNT} modes` },
  { type: "humps", name: "Humps", subtitle: "envelope" },
];

function formatHz(x: number) {
  if (x >= 1000) return `${(x / 1000).toFixed(2)} kHz`;
  return `${Math.round(x)} Hz`;
}

function timeLabelForSlot(start: number, end: number) {
  return `${start.toFixed(1)}–${end.toFixed(1)}s`;
}

type BrowserWindowWithWebkitAudio = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

function BannerHeader({
  left,
  right,
}: {
  left: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="overflow-hidden border-b">
      {/* Layer order is DOM order: gradient -> bubbles -> text; do not introduce z-index here. */}
      <div className="relative px-6 py-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(to right, rgb(248 250 252), rgb(239 246 255), rgb(241 245 249))" }}
        />

        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-8 left-10 h-16 w-16 rounded-full" style={{ background: "rgba(59,130,246,0.16)" }} />
          <div className="absolute top-2 left-44 h-8 w-8 rounded-full" style={{ background: "rgba(14,165,233,0.2)" }} />
          <div className="absolute bottom-0 left-1/3 h-10 w-10 rounded-full" style={{ background: "rgba(16,185,129,0.14)" }} />
          <div className="absolute -top-10 right-24 h-16 w-16 rounded-full" style={{ background: "rgba(99,102,241,0.12)" }} />
          <div className="absolute bottom-1 right-8 h-7 w-7 rounded-full" style={{ background: "rgba(59,130,246,0.2)" }} />
        </div>

        <div className="relative flex items-center justify-between">
          {left}
          {right}
        </div>
      </div>
    </div>
  );
}

function AppBanner() {
  return (
    <div className="overflow-hidden border-b">
      <div className="relative px-6 py-6 flex items-center justify-center" style={{ minHeight: "150px" }}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: "linear-gradient(135deg, rgb(30 58 138), rgb(34 255 136))",
          }}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: 0.9,
            backgroundImage:
              "radial-gradient(circle at 6% 22%, rgba(180, 35, 255, 0.62) 0 10px, rgba(255, 0, 210, 0.97) 11px 13px, transparent 14px)," +
              "radial-gradient(circle at 24% 50%, rgba(195, 55, 255, 0.58) 0 8px, rgba(255, 0, 210, 0.95) 9px 10px, transparent 11px)," +
              "radial-gradient(circle at 52% 36%, rgba(178, 45, 255, 0.56) 0 7px, rgba(255, 0, 210, 0.95) 8px 9px, transparent 10px)," +
              "radial-gradient(circle at 70% 42%, rgba(165, 18, 245, 0.6) 0 9px, rgba(255, 0, 210, 0.96) 10px 11px, transparent 13px)," +
              "radial-gradient(circle at 94% 24%, rgba(210, 88, 255, 0.56) 0 5px, rgba(255, 0, 210, 0.93) 6px 8px, transparent 9px)," +
              "radial-gradient(circle at 16% 76%, rgba(180, 35, 255, 0.54) 0 12px, rgba(255, 0, 210, 0.95) 13px 14px, transparent 16px)," +
              "radial-gradient(circle at 36% 70%, rgba(195, 55, 255, 0.52) 0 8px, rgba(255, 0, 210, 0.92) 9px 10px, transparent 11px)," +
              "radial-gradient(circle at 60% 82%, rgba(165, 18, 245, 0.52) 0 7px, rgba(255, 0, 210, 0.92) 8px 9px, transparent 10px)," +
              "radial-gradient(circle at 80% 66%, rgba(178, 45, 255, 0.52) 0 9px, rgba(255, 0, 210, 0.93) 10px 11px, transparent 13px)," +
              "radial-gradient(circle at 92% 84%, rgba(195, 55, 255, 0.48) 0 8px, rgba(255, 0, 210, 0.9) 9px 10px, transparent 11px)," +
              "radial-gradient(circle at 10% -20%, rgba(165, 18, 245, 0.42) 0 32px, rgba(255, 0, 210, 0.9) 33px 36px, transparent 37px)," +
              "radial-gradient(circle at 88% 118%, rgba(180, 35, 255, 0.4) 0 30px, rgba(255, 0, 210, 0.88) 31px 34px, transparent 35px)",
          }}
        />

        <h1
          className="relative text-center"
          style={{
            fontSize: "3em",
            color: "#ffffff",
            textShadow: "2px 2px 4px #555",
          }}
        >
          (<span style={{ color: "#ffd700" }}>M</span>)ake (<span style={{ color: "#ffd700" }}>A</span>) (<span style={{ color: "#ffd700" }}>T</span>)une (<span style={{ color: "#ffd700" }}>H</span>)ere
        </h1>
      </div>
    </div>
  );
}

// ----------------------------
// Main component
// ----------------------------

export default function SoundWavesPresentationMockup() {
  const [waveType, setWaveType] = useState<WaveType>("sine");
  const [amp, setAmp] = useState(1.0);
  const [freqHz, setFreqHz] = useState(220);
  const [customModes, setCustomModes] = useState<number[]>(() => [...DEFAULT_CUSTOM_MODES]);
  const [customDraftModes, setCustomDraftModes] = useState<number[]>(() => [...DEFAULT_CUSTOM_MODES]);
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [showModeUnderlay, setShowModeUnderlay] = useState(false);

  // Amani and Jacob are cool.
  // ----------------------------
  // Audio (continuous synth with smooth parameter updates)
  // ----------------------------
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletReadyRef = useRef<Promise<void> | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const timelineTimersRef = useRef<number[]>([]);
  const timelineRafRef = useRef<number | null>(null);
  const timelineStartRef = useRef<number | null>(null);
  const pendingParamsRef = useRef<{ freqHz: number; amp: number; waveType: WaveType; customModes: number[] } | null>(null);

  const [playing, setPlaying] = useState<null | "base" | "modified" | "inspectorSample" | "timeline" | "customDraft" | "tilePreview">(null);
  const [playingTileType, setPlayingTileType] = useState<WaveType | null>(null);
  const [timelineProgress, setTimelineProgress] = useState<number | null>(null);
  const [inspectorAnimationProgressSec, setInspectorAnimationProgressSec] = useState(0);

  const ensureAudioContext = useCallback(async () => {
    let ctx = audioCtxRef.current;
    if (!ctx) {
      const browserWindow = window as BrowserWindowWithWebkitAudio;
      const Ctx = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
      if (!Ctx) {
        throw new Error("Web Audio API is not available in this browser.");
      }
      ctx = new Ctx();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx;
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

            this.currentModes = Array(10).fill(0);
            this.currentModes[0] = 1;
            this.targetModes = Array(10).fill(0);
            this.targetModes[0] = 1;

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

              if (Array.isArray(m.customModes)) {
                for (let i = 0; i < 10; i++) {
                  const v = Number(m.customModes[i] ?? 0);
                  this.targetModes[i] = isFinite(v) ? v : 0;
                }
              }
            };
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
                const s = Math.abs(Math.sin(phase * 0.5));
                return 2 * Math.pow(s, 0.8) - 1;
              }
              case 'custom': {
                let sum = 0;
                for (let i = 0; i < 10; i++) {
                  sum += this.currentModes[i] * Math.sin(phase * (i + 1));
                }
                return Math.max(-1, Math.min(1, sum));
              }
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
              for (let j = 0; j < 10; j++) {
                this.currentModes[j] += (this.targetModes[j] - this.currentModes[j]) * kWave;
              }

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

  const postParamsNow = useCallback((p: { freqHz: number; amp: number; waveType: WaveType; customModes: number[] }) => {
    workletNodeRef.current?.port.postMessage({ type: "params", ...p });
  }, []);

  const scheduleParams = useCallback((p: { freqHz: number; amp: number; waveType: WaveType; customModes: number[] }) => {
    pendingParamsRef.current = p;
    if (rafRef.current != null) return;

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const q = pendingParamsRef.current;
      if (!q || !workletNodeRef.current) return;
      workletNodeRef.current.port.postMessage({ type: "params", ...q });
    });
  }, []);

  const stopPlayback = useCallback((immediate = false) => {
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingParamsRef.current = null;

    if (stopTimerRef.current != null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    timelineTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    timelineTimersRef.current = [];

    if (timelineRafRef.current != null) {
      window.cancelAnimationFrame(timelineRafRef.current);
      timelineRafRef.current = null;
    }
    timelineStartRef.current = null;
    setTimelineProgress(null);

    const ctx = audioCtxRef.current;
    const g = masterGainRef.current;

    if (ctx && g) {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      if (immediate) {
        g.gain.setValueAtTime(0.0001, now);
      } else {
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
        g.gain.linearRampToValueAtTime(0.0001, now + PLAYBACK_FADE_SECONDS);
      }
    }

    const finishStop = () => {
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
      setPlayingTileType(null);
    };

    if (immediate) {
      finishStop();
      return;
    }

    // Disconnect shortly after fade.
    window.setTimeout(finishStop, PLAYBACK_FADE_SECONDS * 1000 + 20);
  }, []);

  const playVariant = useCallback(
    async (variant: "base" | "modified") => {
      if (playing === variant) {
        stopPlayback(true);
        return;
      }

      stopPlayback(true);

      const ctx = await ensureSynthNode();
      const g = masterGainRef.current;

      // Prepare params for the chosen variant.
      const params =
        variant === "base"
          ? { freqHz: BASE_FREQUENCY_HZ, amp: 1.0, waveType, customModes }
          : { freqHz, amp, waveType, customModes };

      // Switching between base/modified: quick gain dip to mask abrupt change.
      if (g) {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0.0001, now);
        postParamsNow(params);
        g.gain.linearRampToValueAtTime(1.0, now + PLAYBACK_FADE_SECONDS);
      } else {
        postParamsNow(params);
      }

      setPlaying(variant);

      // Auto-stop after 2 seconds.
      stopTimerRef.current = window.setTimeout(() => {
        stopPlayback();
      }, 2000);
    },
    [amp, customModes, ensureSynthNode, freqHz, playing, postParamsNow, stopPlayback, waveType]
  );

  const playInspectorSample = useCallback(async () => {
    if (playing === "inspectorSample") {
      stopPlayback(true);
      return;
    }

    stopPlayback(true);

    const ctx = await ensureSynthNode();
    const g = masterGainRef.current;
    const sampleParams = { freqHz, amp, waveType, customModes };

    if (g) {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(0.0001, now);
      postParamsNow(sampleParams);
      g.gain.linearRampToValueAtTime(1.0, now + PLAYBACK_FADE_SECONDS);
    } else {
      postParamsNow(sampleParams);
    }

    setPlaying("inspectorSample");

    stopTimerRef.current = window.setTimeout(() => {
      stopPlayback();
    }, 10_000);
  }, [amp, customModes, ensureSynthNode, freqHz, playing, postParamsNow, stopPlayback, waveType]);

  const playWaveTilePreview = useCallback(
    async (type: WaveType) => {
      if (playing === "tilePreview" && playingTileType === type) {
        stopPlayback(true);
        return;
      }

      stopPlayback(true);

      const ctx = await ensureSynthNode();
      const g = masterGainRef.current;
      const previewModes = type === "custom" ? customModes : [...DEFAULT_CUSTOM_MODES];

      if (g) {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0.0001, now);
        postParamsNow({ freqHz, amp: 1.0, waveType: type, customModes: previewModes });
        g.gain.linearRampToValueAtTime(1.0, now + PLAYBACK_FADE_SECONDS);
      } else {
        postParamsNow({ freqHz, amp: 1.0, waveType: type, customModes: previewModes });
      }

      setPlaying("tilePreview");
      setPlayingTileType(type);

      stopTimerRef.current = window.setTimeout(() => {
        stopPlayback();
      }, 2000);
    },
    [customModes, ensureSynthNode, freqHz, playing, playingTileType, postParamsNow, stopPlayback]
  );

  const nextTimelineIdRef = useRef(DEFAULT_TIMELINE_NOTES + 1);
  const [timelineSlots, setTimelineSlots] = useState<TimelineSlot[]>(
    [...Array(DEFAULT_TIMELINE_NOTES)].map((_, index) => ({ id: index + 1, slot: { kind: "empty" }, weight: 1 }))
  );
  const hasTimelineContent = useMemo(() => timelineSlots.some((entry) => entry.slot.kind === "wave"), [timelineSlots]);

  const segmentBoundaries = useMemo(() => {
    const totalWeight = timelineSlots.reduce((acc, entry) => acc + entry.weight, 0);
    let accWeight = 0;
    return timelineSlots.map((entry) => {
      const start = totalWeight > 0 ? accWeight / totalWeight : 0;
      accWeight += entry.weight;
      const end = totalWeight > 0 ? accWeight / totalWeight : 0;
      return { start, end };
    });
  }, [timelineSlots]);

  const activeTimelineSlot = useMemo(() => {
    if (!(playing === "timeline" && timelineProgress != null)) return null;
    const progress = clamp(timelineProgress, 0, 0.999999);
    const index = segmentBoundaries.findIndex((segment) => progress >= segment.start && progress < segment.end);
    return index >= 0 ? index : timelineSlots.length - 1;
  }, [playing, timelineProgress, segmentBoundaries, timelineSlots.length]);

  const timelineProgressPct = (timelineProgress ?? 0) * 100;

  useEffect(() => {
    if (playing !== "base" && playing !== "modified" && playing !== "inspectorSample") return;

    const start = performance.now();
    let animationFrameId: number;

    const tick = (now: number) => {
      const elapsedSec = (now - start) / 1000;
      setInspectorAnimationProgressSec(elapsedSec);
      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [playing]);

  const playTimeline = useCallback(async () => {
    stopPlayback(true);

    const ctx = await ensureSynthNode();
    const g = masterGainRef.current;
    const timelineLengthMs = TIMELINE_TOTAL_SECONDS * 1000;
    const totalWeight = timelineSlots.reduce((acc, entry) => acc + entry.weight, 0);

    const slotDurationsMs = timelineSlots.map((entry) => (totalWeight > 0 ? (entry.weight / totalWeight) * timelineLengthMs : 0));
    const slotParams = timelineSlots.map((entry) =>
      entry.slot.kind === "wave"
        ? {
            freqHz: entry.slot.freqHz,
            amp: entry.slot.amp,
            waveType: entry.slot.type,
            customModes: entry.slot.customModes ?? customModes,
          }
        : { freqHz: 220, amp: 0, waveType: "sine" as WaveType, customModes }
    );

    postParamsNow(slotParams[0]);

    if (g) {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(1.0, now + PLAYBACK_FADE_SECONDS);
    }

    setPlaying("timeline");
    timelineStartRef.current = performance.now();
    setTimelineProgress(0);

    const tick = () => {
      if (timelineStartRef.current == null) return;
      const elapsed = performance.now() - timelineStartRef.current;
      const progress = clamp(elapsed / timelineLengthMs, 0, 1);
      setTimelineProgress(progress);
      if (progress < 1) {
        timelineRafRef.current = window.requestAnimationFrame(tick);
      }
    };

    timelineRafRef.current = window.requestAnimationFrame(tick);

    let elapsedMs = 0;
    timelineTimersRef.current = slotParams.slice(1).map((params, idx) => {
      elapsedMs += slotDurationsMs[idx];
      return window.setTimeout(() => {
        postParamsNow(params);
      }, elapsedMs);
    });

    stopTimerRef.current = window.setTimeout(() => {
      stopPlayback();
    }, timelineLengthMs);
  }, [customModes, ensureSynthNode, postParamsNow, timelineSlots, stopPlayback]);

  // While playing, reflect slider and wave-shape changes immediately.
  useEffect(() => {
    if (!playing || playing === "timeline" || playing === "tilePreview") return;

    if (playing === "customDraft") {
      scheduleParams({
        freqHz,
        amp,
        waveType: "custom",
        customModes: normalizeModes(customDraftModes),
      });
      return;
    }

    const p = playing === "base" ? { freqHz: 220, amp: 1.0, waveType, customModes } : { freqHz, amp, waveType, customModes };
    scheduleParams(p);
  }, [playing, waveType, amp, freqHz, customModes, customDraftModes, scheduleParams]);

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
  const inspectorWindowSec = secondsForPeriods(BASE_FREQUENCY_HZ);
  const inspectorAnimatedOffsetSec =
    (playing === "base" || playing === "modified" || playing === "inspectorSample" ? inspectorAnimationProgressSec : 0) *
    INSPECTOR_SCROLL_GRAPHS_PER_SECOND *
    inspectorWindowSec;
  const baseInspectorTimeOffsetSec = playing === "base" ? inspectorAnimatedOffsetSec : 0;
  const modifiedInspectorTimeOffsetSec =
    playing === "modified" || playing === "inspectorSample" ? inspectorAnimatedOffsetSec : 0;

  const basePath = useMemo(() => {
    return makeWavePath({
      type: waveType,
      amp: 1,
      freqHz: BASE_FREQUENCY_HZ,
      width: 760,
      height: 280,
      seconds: inspectorWindowSec,
      timeOffsetSec: baseInspectorTimeOffsetSec,
      samples: 320,
      yPad: 14,
      customModes,
    });
  }, [waveType, customModes, inspectorWindowSec, baseInspectorTimeOffsetSec]);

  const modifiedPath = useMemo(() => {
    return makeWavePath({
      type: waveType,
      amp,
      freqHz,
      width: 760,
      height: 280,
      seconds: inspectorWindowSec,
      timeOffsetSec: modifiedInspectorTimeOffsetSec,
      samples: 320,
      yPad: 14,
      customModes,
    });
  }, [waveType, amp, freqHz, customModes, inspectorWindowSec, modifiedInspectorTimeOffsetSec]);

  const customDraftPath = useMemo(() => {
    return makeWavePath({
      type: "custom",
      amp: 2,
      freqHz,
      width: 980,
      height: 360,
      seconds: secondsForPeriods(freqHz),
      samples: 320,
      yPad: 6,
      customModes: normalizeModes(customDraftModes),
    });
  }, [freqHz, customDraftModes]);

  const customDraftModePaths = useMemo(
    () =>
      customDraftModes.map((mode, i) => {
        const customMode = Array(CUSTOM_MODE_COUNT).fill(0);
        customMode[i] = mode;
        return makeWavePath({
          type: "custom",
          amp: 2,
          freqHz,
          width: 980,
          height: 360,
          seconds: secondsForPeriods(freqHz),
          samples: 560,
          yPad: 16,
          customModes: customMode,
        });
      }),
    [customDraftModes, freqHz]
  );

  function placeInSlot(i: number) {
    setTimelineSlots((prev) => {
      const next = [...prev];
      next[i] = {
        ...next[i],
        slot: {
          kind: "wave",
          type: waveType,
          amp,
          freqHz,
          customModes: waveType === "custom" ? [...customModes] : undefined,
          label:
            waveType === "custom"
              ? `Custom mix · ${formatHz(freqHz)}`
              : `${WAVE_TILES.find((w) => w.type === waveType)?.name ?? waveType} · ${formatHz(freqHz)}`,
        },
      };
      return next;
    });
  }

  function clearTimeline() {
    setTimelineSlots((prev) => prev.map((entry) => ({ ...entry, slot: { kind: "empty" }, weight: 1 })));
  }

  function updateSlotWeight(i: number, weight: number) {
    setTimelineSlots((prev) => prev.map((entry, idx) => (idx === i ? { ...entry, weight } : entry)));
  }

  function insertSlotBetween(i: number) {
    setTimelineSlots((prev) => {
      if (prev.length >= MAX_TIMELINE_NOTES) return prev;
      const before = prev[i];
      const after = prev[i + 1];
      const nextId = nextTimelineIdRef.current;
      nextTimelineIdRef.current += 1;
      const newWeight = clamp(((before?.weight ?? 1) + (after?.weight ?? 1)) / 2, MIN_SLOT_WEIGHT, MAX_SLOT_WEIGHT);
      const next = [...prev];
      next.splice(i + 1, 0, { id: nextId, slot: { kind: "empty" }, weight: newWeight });
      return next;
    });
  }

  function removeSlot(i: number) {
    setTimelineSlots((prev) => {
      if (prev.length <= MIN_TIMELINE_NOTES) return prev;
      const next = [...prev];
      next.splice(i, 1);
      return next;
    });
  }

  function openCustomEditor() {
    setCustomDraftModes([...customModes]);
    setCustomEditorOpen(true);
  }

  function closeCustomEditor() {
    setCustomEditorOpen(false);
  }

  function saveCustomEditor() {
    const normalized = normalizeModes(customDraftModes);
    setCustomModes(normalized);
    setWaveType("custom");
    setCustomEditorOpen(false);
  }

  function updateCustomMode(index: number, value: number) {
    setCustomDraftModes((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function playCustomDraft() {
    const draft = normalizeModes(customDraftModes);
    stopPlayback(true);
    const ctx = await ensureSynthNode();
    const g = masterGainRef.current;
    if (g) {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(0.0001, now);
      postParamsNow({ freqHz, amp, waveType: "custom", customModes: draft });
      g.gain.linearRampToValueAtTime(1.0, now + PLAYBACK_FADE_SECONDS);
    }
    setPlaying("customDraft");
    stopTimerRef.current = window.setTimeout(() => {
      stopPlayback();
    }, 2000);
  }

  return (
    <div className="h-screen w-screen bg-slate-50 text-slate-900 flex flex-col">
      <AppBanner />

      {/* Main */}
      <div className="h-full w-full flex flex-1 min-h-0 flex-col gap-5 p-5 bg-gradient-to-br from-[#1e3a8a]/55 via-[#34d399]/45 to-[#c2410c]/50">
        <div className="min-h-0 flex-[2] flex gap-5">
          {/* Left column (1/3) */}
          <div className="w-1/3 min-w-[360px] rounded-3xl border bg-white p-5 overflow-auto">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">▶ 1) Select wave</div>
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
                seconds: secondsForPeriods(4),
                samples: 120,
                yPad: 10,
                customModes,
              });
              return (
                <div
                  key={w.type}
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

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => playWaveTilePreview(w.type)}
                        className="h-6 w-6 rounded-full border border-slate-200 text-slate-500 text-[10px] leading-none transition hover:bg-slate-100 hover:text-slate-700"
                        aria-label={
                          playing === "tilePreview" && playingTileType === w.type
                            ? `Stop ${w.name} waveform preview`
                            : `Play ${w.name} waveform for 2 seconds at ${formatHz(freqHz)}`
                        }
                        title={
                          playing === "tilePreview" && playingTileType === w.type
                            ? "Stop preview"
                            : `Play preview at ${formatHz(freqHz)}`
                        }
                      >
                        {playing === "tilePreview" && playingTileType === w.type ? "■" : "▶"}
                      </button>

                      <button
                        type="button"
                        onClick={() => (w.type === "custom" ? openCustomEditor() : setWaveType(w.type))}
                        className={
                          "text-[10px] px-2 py-1 rounded-full border transition " +
                          (selected
                            ? "border-slate-900 text-slate-900 bg-white"
                            : "border-slate-200 text-slate-500 hover:bg-slate-100")
                        }
                      >
                        {w.type === "custom" ? "Edit" : selected ? "Selected" : "Pick"}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => (w.type === "custom" ? openCustomEditor() : setWaveType(w.type))}
                    className="mt-2 w-full rounded-xl bg-white border overflow-hidden"
                    aria-label={`Select ${w.name} waveform`}
                  >
                    <svg width="100%" height="90" viewBox="0 0 160 90" className="block">
                      <path d={tilePath} fill="none" stroke="currentColor" strokeWidth="3" className="text-slate-800" />
                      <line x1="0" y1="45" x2="160" y2="45" className="stroke-slate-200" strokeWidth="1" />
                    </svg>
                  </button>
                </div>
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
          <div className="w-2/3 min-h-0">
            <div className="h-full rounded-3xl border bg-white shadow-sm overflow-hidden flex flex-col">
              <BannerHeader
                left={
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-500">2) Modify</div>
                    <div className="text-lg font-semibold">Wave Inspector</div>
                  </div>
                }
                right={
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-slate-500">Base: 220 Hz, amp 1</div>
                    <div className="h-2 w-2 rounded-full bg-slate-900" title="Modified" />
                    <div className="text-xs text-slate-600">Modified</div>
                    <div className="h-2 w-2 rounded-full bg-slate-300" title="Base" />
                    <div className="text-xs text-slate-500">Base</div>
                  </div>
                }
              />

              <div className="flex-1 flex min-h-0">
                {/* Plot */}
                <div className="flex-1 p-6 min-w-0">
                  <div className="h-full rounded-2xl border bg-slate-50 p-4 flex flex-col">
                    <div className="text-sm font-medium flex items-center justify-between">
                      <span>
                        {WAVE_TILES.find((w) => w.type === waveType)?.name ?? waveType} · {formatHz(freqHz)} · amp {amp.toFixed(2)}
                      </span>
                      <span className="text-xs text-slate-500">window: 3 periods at 220 Hz</span>
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
                      This plot overlays a base wave (220 Hz, amp 1) with the modified wave (current sliders). Click either curve to
                      preview for 2 seconds.
                    </div>
                  </div>
                </div>

                {/* Sliders */}
                <div className="w-[320px] border-l p-6 bg-white">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">Controls</div>
                    <button
                      type="button"
                      onClick={playInspectorSample}
                      className="rounded-xl border bg-white px-6 py-3 text-base font-semibold leading-none hover:bg-slate-50"
                    >
                      {playing === "inspectorSample" ? "⏸ Pause" : "▶ Play"}
                    </button>
                  </div>

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
                      <div className="mt-2 text-[11px] text-slate-500">
                        Use the play/pause button in the Controls header to hear this modified waveform for up to 10 seconds.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PRODUCE (full-width bottom panel) */}
        <div className="min-h-0 flex-1">
          <div className="h-full rounded-3xl border bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">3) Produce</div>
                  <div className="text-lg font-semibold">10-second Timeline</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={playTimeline}
                    disabled={!hasTimelineContent}
                    className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {playing === "timeline" ? "Playing…" : "Play all"}
                  </button>
                  <button
                    onClick={clearTimeline}
                    className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex-1 p-6 flex flex-col min-h-0">
                {/* timeline transport + slots */}
                <div className="min-h-0">
                  <div className="mb-3 relative h-2 w-full rounded-full bg-slate-200" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-[width] duration-100"
                      style={{ width: `${timelineProgressPct}%` }}
                    />
                    {timelineProgress != null && (
                      <div
                        className="absolute h-3 w-3 rounded-full border border-blue-600 bg-blue-500 shadow"
                        style={{ left: `${timelineProgressPct}%`, top: "50%", transform: "translate(-50%, -50%)" }}
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
                    <span>{timelineSlots.length} notes</span>
                    <span>•</span>
                    <span>min {MIN_TIMELINE_NOTES}</span>
                    <span>•</span>
                    <span>max {MAX_TIMELINE_NOTES}</span>
                  </div>

                  <div className="flex gap-3 min-h-0 overflow-x-auto pb-2">
                    {timelineSlots.map((entry, i) => {
                      const label = timeLabelForSlot(
                        segmentBoundaries[i].start * TIMELINE_TOTAL_SECONDS,
                        segmentBoundaries[i].end * TIMELINE_TOTAL_SECONDS
                      );
                      const waveSlot = entry.slot.kind === "wave" ? entry.slot : undefined;
                      const filled = waveSlot != null;
                      const isActive = activeTimelineSlot === i;
                      const miniPath = filled
                        ? makeWavePath({
                            type: waveSlot!.type,
                            amp: waveSlot!.amp,
                            freqHz: waveSlot!.freqHz,
                            width: 220,
                            height: 80,
                            seconds: 0.02,
                            samples: 120,
                            yPad: 10,
                            customModes: waveSlot!.customModes ?? customModes,
                          })
                        : null;

                      return (
                        <div key={entry.id} className="flex items-center gap-3 min-w-[280px]">
                          <div className="flex flex-col min-h-0 flex-1">
                            <div
                              className={
                                "relative flex-1 rounded-2xl border p-3 bg-slate-50 flex flex-col min-h-0 transition-colors duration-200 " +
                                (filled ? "border-slate-300" : "border-dashed border-slate-300") +
                                (isActive ? " ring-2 ring-blue-200 border-blue-400 bg-blue-50 shadow-lg" : "")
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
                                  <div className="h-full w-full flex items-center justify-center text-xs text-slate-400">empty</div>
                                )}
                              </div>
                              <div className="mt-2 text-xs text-slate-600 truncate">{waveSlot?.label ?? "—"}</div>
                              <div className="mt-2">
                                <div className="text-[11px] text-slate-500 mb-1">Length</div>
                                <input
                                  type="range"
                                  min={MIN_SLOT_WEIGHT}
                                  max={MAX_SLOT_WEIGHT}
                                  step={0.1}
                                  value={entry.weight}
                                  onChange={(e) => updateSlotWeight(i, Number(e.target.value))}
                                  className="w-full"
                                />
                              </div>
                            </div>
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => placeInSlot(i)}
                                className="flex-1 rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800"
                              >
                                Add here
                              </button>
                              <button
                                onClick={() => removeSlot(i)}
                                disabled={timelineSlots.length <= MIN_TIMELINE_NOTES}
                                className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:text-slate-300"
                              >
                                −
                              </button>
                            </div>
                          </div>
                          {i < timelineSlots.length - 1 && (
                            <button
                              type="button"
                              onClick={() => insertSlotBetween(i)}
                              disabled={timelineSlots.length >= MAX_TIMELINE_NOTES}
                              className="h-10 w-10 rounded-full border bg-white text-lg text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
                              title="Add note slot between"
                            >
                              +
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>


                <div className="mt-4 text-xs text-slate-500">
                  Notes are resizable and always total {TIMELINE_TOTAL_SECONDS} seconds. Use the + buttons to insert between notes.
                </div>
              </div>
            </div>
          </div>
        </div>
      {customEditorOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-h-[96vh] overflow-auto rounded-3xl border bg-white shadow-2xl" style={{ maxWidth: "min(96vw, 1400px)" }}>
            <div className="px-6 py-4 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500">Custom waveform applet</div>
                <div className="text-lg font-semibold">Mix {CUSTOM_MODE_COUNT} sine modes</div>
              </div>
              <button onClick={closeCustomEditor} className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50">Close</button>
            </div>

            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
              <button onClick={playCustomDraft} className="rounded-2xl border bg-slate-50 p-4 text-left hover:border-slate-400">
                <div className="text-sm font-medium flex items-center justify-between">
                  <span>Click waveform to play preview</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowModeUnderlay((prev) => !prev);
                      }}
                      className={
                        "rounded-xl border bg-white px-3 py-1 text-xs " +
                        (showModeUnderlay ? "border-blue-600 text-blue-600" : "text-slate-600")
                      }
                    >
                      {showModeUnderlay ? "Hide" : "Show"} mode underlay
                    </button>
                    <span className="text-xs text-slate-500">2 seconds</span>
                  </div>
                </div>
                <div className="mt-2 text-center text-sm font-medium text-slate-700">Playing at {formatHz(freqHz)}</div>
                <svg viewBox="0 0 980 360" className="mt-3 w-full rounded-xl border bg-white" style={{ height: "24rem" }}>
                  <line x1="0" y1="180" x2="980" y2="180" stroke="rgb(226,232,240)" strokeWidth="2" />
                  {showModeUnderlay &&
                    customDraftModePaths.map((modePath, i) => (
                      <path
                        key={i}
                        d={modePath}
                        fill="none"
                        stroke={getModeColor(i)}
                        strokeWidth="2"
                        opacity={0.24}
                      />
                    ))}
                  <path d={customDraftPath} fill="none" stroke="rgb(15,23,42)" strokeWidth="4" />
                </svg>
              </button>

              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="text-sm font-medium">Harmonic sliders</div>
                <div className="mt-3 space-y-3">
                  {customDraftModes.map((mode, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>
                          sin(2π f <span style={{ color: getModeColor(i) }}>{i + 1}</span> x)
                        </span>
                        <span className="tabular-nums">{mode.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={mode}
                        onChange={(e) => updateCustomMode(i, parseFloat(e.target.value))}
                        className="w-full bipolar-slider"
                        style={{ background: getBipolarSliderBackground(mode, getModeColor(i)) }}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setCustomDraftModes([...DEFAULT_CUSTOM_MODES])}
                    className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    Reset modes
                  </button>
                  <button onClick={saveCustomEditor} className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800">
                    Save to library slot
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
