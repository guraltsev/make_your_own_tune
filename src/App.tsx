import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function getBipolarSliderBackground(value: number) {
  const trackColor = "rgb(226,232,240)";
  const fillColor = "rgb(37,99,235)";
  const clamped = clamp(value, -1, 1);
  const pointPercent = ((clamped + 1) / 2) * 100;

  if (pointPercent >= 50) {
    return `linear-gradient(to right, ${trackColor} 0%, ${trackColor} 50%, ${fillColor} 50%, ${fillColor} ${pointPercent}%, ${trackColor} ${pointPercent}%, ${trackColor} 100%)`;
  }

  return `linear-gradient(to right, ${trackColor} 0%, ${trackColor} ${pointPercent}%, ${fillColor} ${pointPercent}%, ${fillColor} 50%, ${trackColor} 50%, ${trackColor} 100%)`;
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

const WAVE_TILES: Array<{ type: WaveType; name: string; subtitle: string }> = [
  { type: "sine", name: "Sine", subtitle: "smooth" },
  { type: "triangle", name: "Triangle", subtitle: "linear ramps" },
  { type: "square", name: "Square", subtitle: "rich harmonics" },
  { type: "saw", name: "Sawtooth", subtitle: "bright" },
  { type: "custom", name: "Custom", subtitle: "15 modes" },
  { type: "humps", name: "Humps", subtitle: "envelope" },
];

const REFERENCE_WAVES: Array<{ type: Exclude<WaveType, "custom">; name: string }> = [
  { type: "sine", name: "Sine" },
  { type: "triangle", name: "Triangle" },
  { type: "square", name: "Square" },
  { type: "saw", name: "Saw" },
  { type: "humps", name: "Humps" },
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

type BrowserWindowWithWebkitAudio = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

// ----------------------------
// Main component
// ----------------------------

export default function SoundWavesPresentationMockup() {
  const [title, setTitle] = useState("Math of Sound Waves");
  const [waveType, setWaveType] = useState<WaveType>("sine");
  const [amp, setAmp] = useState(1.0);
  const [freqHz, setFreqHz] = useState(220);
  const [customModes, setCustomModes] = useState<number[]>(() => [...DEFAULT_CUSTOM_MODES]);
  const [customDraftModes, setCustomDraftModes] = useState<number[]>(() => [...DEFAULT_CUSTOM_MODES]);
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [referenceWaveType, setReferenceWaveType] = useState<Exclude<WaveType, "custom">>("sine");
  const [showFourierModes, setShowFourierModes] = useState(false);

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

            this.currentModes = Array(15).fill(0);
            this.currentModes[0] = 1;
            this.targetModes = Array(15).fill(0);
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
                for (let i = 0; i < 15; i++) {
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
                for (let i = 0; i < 15; i++) {
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
              for (let j = 0; j < 15; j++) {
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
        g.gain.setTargetAtTime(0.0001, now, 0.02);
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
    window.setTimeout(finishStop, 80);
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
        g.gain.linearRampToValueAtTime(1.0, now + 0.03);
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
      g.gain.linearRampToValueAtTime(1.0, now + 0.03);
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
        g.gain.linearRampToValueAtTime(1.0, now + 0.03);
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

  const [slots, setSlots] = useState<Slot[]>([...Array(5)].map(() => ({ kind: "empty" })));
  const hasTimelineContent = useMemo(() => slots.some((slot) => slot.kind === "wave"), [slots]);
  const activeTimelineSlot =
    playing === "timeline" && timelineProgress != null ? Math.min(4, Math.floor(timelineProgress * 5)) : null;
  const slotProgressWithinActive =
    playing === "timeline" && timelineProgress != null ? (timelineProgress * 5) % 1 : 0;
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
    const timelineLengthMs = 10_000;
    const slotLengthMs = 2_000;

    const slotParams = slots.map((slot) =>
      slot.kind === "wave"
        ? { freqHz: slot.freqHz, amp: slot.amp, waveType: slot.type, customModes: slot.customModes ?? customModes }
        : { freqHz: 220, amp: 0, waveType: "sine" as WaveType, customModes }
    );

    postParamsNow(slotParams[0]);

    if (g) {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(1.0, now + 0.03);
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

    timelineTimersRef.current = slotParams.slice(1).map((params, idx) =>
      window.setTimeout(() => {
        postParamsNow(params);
      }, slotLengthMs * (idx + 1))
    );

    stopTimerRef.current = window.setTimeout(() => {
      stopPlayback();
    }, timelineLengthMs);
  }, [customModes, ensureSynthNode, postParamsNow, slots, stopPlayback]);

  // While playing, reflect slider and wave-shape changes immediately.
  useEffect(() => {
    if (!playing || playing === "timeline" || playing === "customDraft" || playing === "tilePreview") return;
    const p = playing === "base" ? { freqHz: 220, amp: 1.0, waveType, customModes } : { freqHz, amp, waveType, customModes };
    scheduleParams(p);
  }, [playing, waveType, amp, freqHz, customModes, scheduleParams]);

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
  const inspectorGraphWidth = 920;
  const inspectorGraphHeight = 360;
  const inspectorWindowSec = secondsForPeriods(BASE_FREQUENCY_HZ);
  const inspectorAnimatedOffsetSec =
    (playing === "base" || playing === "modified" || playing === "inspectorSample" ? inspectorAnimationProgressSec : 0) *
    INSPECTOR_SCROLL_GRAPHS_PER_SECOND *
    inspectorWindowSec;
  const baseInspectorTimeOffsetSec = playing === "base" ? inspectorAnimatedOffsetSec : 0;
  const modifiedInspectorTimeOffsetSec =
    playing === "modified" || playing === "inspectorSample" ? inspectorAnimatedOffsetSec : 0;

  const referencePath = useMemo(() => {
    return makeWavePath({
      type: referenceWaveType,
      amp: 1,
      freqHz,
      width: inspectorGraphWidth,
      height: inspectorGraphHeight,
      seconds: inspectorWindowSec,
      timeOffsetSec: modifiedInspectorTimeOffsetSec,
      samples: 360,
      yPad: 16,
    });
  }, [referenceWaveType, freqHz, inspectorWindowSec, modifiedInspectorTimeOffsetSec]);

  const fourierModePaths = useMemo(() => {
    if (!(showFourierModes && waveType === "custom")) return [];
    const normalizedModes = normalizeModes(customModes);
    return normalizedModes
      .map((mode, index) => ({ mode, index }))
      .filter(({ mode }) => Math.abs(mode) > 0.001)
      .map(({ mode, index }) =>
        makeWavePath({
          type: "custom",
          amp: 2,
          freqHz,
          width: inspectorGraphWidth,
          height: inspectorGraphHeight,
          seconds: inspectorWindowSec,
          timeOffsetSec: modifiedInspectorTimeOffsetSec,
          samples: 360,
          yPad: 16,
          customModes: Array.from({ length: CUSTOM_MODE_COUNT }, (_, i) => (i === index ? mode : 0)),
        })
      );
  }, [showFourierModes, waveType, customModes, freqHz, inspectorWindowSec, modifiedInspectorTimeOffsetSec]);

  const basePath = useMemo(() => {
    return makeWavePath({
      type: waveType,
      amp: 1,
      freqHz: BASE_FREQUENCY_HZ,
      width: inspectorGraphWidth,
      height: inspectorGraphHeight,
      seconds: inspectorWindowSec,
      timeOffsetSec: baseInspectorTimeOffsetSec,
      samples: 360,
      yPad: 16,
      customModes,
    });
  }, [waveType, customModes, inspectorGraphWidth, inspectorGraphHeight, inspectorWindowSec, baseInspectorTimeOffsetSec]);

  const modifiedPath = useMemo(() => {
    return makeWavePath({
      type: waveType,
      amp,
      freqHz,
      width: inspectorGraphWidth,
      height: inspectorGraphHeight,
      seconds: inspectorWindowSec,
      timeOffsetSec: modifiedInspectorTimeOffsetSec,
      samples: 360,
      yPad: 16,
      customModes,
    });
  }, [waveType, amp, freqHz, customModes, inspectorGraphWidth, inspectorGraphHeight, inspectorWindowSec, modifiedInspectorTimeOffsetSec]);

  const customDraftPath = useMemo(() => {
    return makeWavePath({
      type: "custom",
      amp: 2,
      freqHz,
      width: 920,
      height: 360,
      seconds: secondsForPeriods(freqHz),
      samples: 320,
      yPad: 6,
      customModes: normalizeModes(customDraftModes),
    });
  }, [freqHz, customDraftModes]);

  function placeInSlot(i: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = {
        kind: "wave",
        type: waveType,
        amp,
        freqHz,
        customModes: waveType === "custom" ? [...customModes] : undefined,
        label:
          waveType === "custom"
            ? `Custom mix · ${formatHz(freqHz)}`
            : `${WAVE_TILES.find((w) => w.type === waveType)?.name ?? waveType} · ${formatHz(freqHz)}`,
      };
      return next;
    });
  }

  function clearTimeline() {
    setSlots([...Array(5)].map(() => ({ kind: "empty" })));
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
      g.gain.linearRampToValueAtTime(1.0, now + 0.03);
    }
    setPlaying("customDraft");
    stopTimerRef.current = window.setTimeout(() => {
      stopPlayback();
    }, 2000);
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
                  <label className="text-xs text-slate-600 flex items-center gap-2 rounded-lg border bg-slate-50 px-2 py-1">
                    <input
                      type="checkbox"
                      checked={showFourierModes}
                      onChange={(e) => setShowFourierModes(e.target.checked)}
                    />
                    Show Fourier modes
                  </label>
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
                      <span className="text-xs text-slate-500">window: 3 periods at 220 Hz</span>
                    </div>

                    <div className="mt-3 grid grid-cols-5 gap-2">
                      {REFERENCE_WAVES.map((ref) => {
                        const active = referenceWaveType === ref.type;
                        const previewPath = makeWavePath({
                          type: ref.type,
                          amp: 1,
                          freqHz: 4,
                          width: 120,
                          height: 54,
                          seconds: secondsForPeriods(4),
                          samples: 90,
                          yPad: 8,
                        });
                        return (
                          <button
                            key={ref.type}
                            type="button"
                            onClick={() => setReferenceWaveType(ref.type)}
                            className={
                              "rounded-lg border p-1 transition " +
                              (active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300")
                            }
                          >
                            <svg viewBox="0 0 120 54" className="h-8 w-full">
                              <line x1="0" y1="27" x2="120" y2="27" stroke="rgb(226,232,240)" strokeWidth="1" />
                              <path d={previewPath} fill="none" stroke="rgb(71,85,105)" strokeWidth="2" />
                            </svg>
                            <div className="text-[10px] text-slate-500">{ref.name}</div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex-1 min-h-0 rounded-xl bg-white border overflow-hidden">
                      <svg
                        viewBox={`0 0 ${inspectorGraphWidth} ${inspectorGraphHeight}`}
                        className="w-full h-full block"
                        preserveAspectRatio="none"
                        aria-label="Wave plot"
                      >
                        {/* axes */}
                        <line x1="0" y1="180" x2="920" y2="180" stroke="rgb(226,232,240)" strokeWidth="2" />
                        <line x1="48" y1="0" x2="48" y2="360" stroke="rgb(226,232,240)" strokeWidth="2" />

                        <path d={referencePath} fill="none" stroke="rgb(59,130,246)" strokeOpacity="0.16" strokeWidth="8" />

                        {fourierModePaths.map((modePath, index) => (
                          <path
                            key={index}
                            d={modePath}
                            fill="none"
                            stroke="rgb(34,197,94)"
                            strokeOpacity="0.22"
                            strokeWidth="2"
                          />
                        ))}

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
                        <text x="54" y="24" fontSize="12" fill="rgb(100,116,139)">Amplitude</text>
                        <text x="846" y="344" fontSize="12" fill="rgb(100,116,139)">time</text>
                      </svg>
                    </div>

                    <div className="mt-3 text-xs text-slate-500">
                      This plot overlays a base wave (220 Hz, amp 1) with the modified wave (current sliders). Use the top mini-tiles
                      to choose a faint reference underlay, and optionally show faint green Fourier modes for custom waves.
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
                      className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                    >
                      {playing === "inspectorSample" ? "Pause" : "Play"}
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

          {/* PRODUCE (1/3 height) */}
          <div className="flex-[1] p-5 pt-0">
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

                  <div className="grid grid-cols-5 gap-3 min-h-0">
                    {slots.map((slot, i) => {
                      const label = timeLabelForSlot(i);
                      const filled = slot.kind === "wave";
                      const isActive = activeTimelineSlot === i;
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
                            customModes: slot.customModes ?? customModes,
                          })
                        : null;

                      return (
                        <div key={i} className="flex flex-col min-h-0">
                          <div
                            className={
                              "relative flex-1 rounded-2xl border p-3 bg-slate-50 flex flex-col min-h-0 transition-colors duration-200 " +
                              (filled ? "border-slate-300" : "border-dashed border-slate-300") +
                              (isActive
                                ? " ring-2 ring-blue-200 border-blue-400 bg-blue-50 shadow-lg"
                                : "")
                            }
                            style={{
                              transform: isActive ? "scale(1.15)" : "scale(1)",
                              transformOrigin: "center",
                              transition: "transform 180ms ease, background-color 180ms ease, border-color 180ms ease",
                              willChange: "transform",
                              zIndex: isActive ? 2 : 1,
                            }}
                          >
                            {isActive && (
                              <div className="absolute top-2 right-2 rounded-full bg-blue-600 text-white text-[10px] px-2 py-0.5 animate-pulse">
                                Playing
                              </div>
                            )}

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

                            {isActive && (
                              <div className="mt-2 h-1 w-full rounded-full bg-blue-100 overflow-hidden" aria-hidden="true">
                                <div
                                  className="h-full bg-blue-500 transition-[width] duration-100"
                                  style={{ width: `${slotProgressWithinActive * 100}%` }}
                                />
                              </div>
                            )}

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

      {customEditorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-[95vw] max-h-[96vh] overflow-auto rounded-3xl border bg-white shadow-2xl">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500">Custom waveform applet</div>
                <div className="text-lg font-semibold">Mix 15 sine modes</div>
              </div>
              <button onClick={closeCustomEditor} className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50">Close</button>
            </div>

            <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
              <button onClick={playCustomDraft} className="rounded-2xl border bg-slate-50 p-4 text-left hover:border-slate-400">
                <div className="text-sm font-medium flex items-center justify-between">
                  <span>Click waveform to play preview</span>
                  <span className="text-xs text-slate-500">2 seconds</span>
                </div>
                <div className="mt-2 text-center text-sm font-medium text-slate-700">Playing at {formatHz(freqHz)}</div>
                <svg viewBox="0 0 920 360" className="mt-3 h-[30rem] w-full rounded-xl border bg-white">
                  <line x1="0" y1="180" x2="920" y2="180" stroke="rgb(226,232,240)" strokeWidth="2" />
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
                          sin(2π f <span className="text-blue-600">{i + 1}</span> x)
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
                        style={{ background: getBipolarSliderBackground(mode) }}
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
