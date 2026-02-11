# Code Analysis: Make Your Own Tune

Date: 2026-02-11

---

## 1. Project Overview

**Make Your Own Tune** is an interactive educational web application for exploring waveform math and sound. Users select waveforms (sine, triangle, square, sawtooth, noise, humps), modify amplitude and frequency with sliders, visually compare base vs. modified waves in an SVG overlay plot, hear 2-second audio previews, and build a 10-second timeline by placing waveform snapshots into five 2-second slots.

| Aspect | Detail |
|--------|--------|
| **Stack** | React 19, TypeScript 5.9, Vite 7.3 |
| **Audio** | Web Audio API with custom AudioWorklet |
| **Styling** | Hand-rolled utility CSS (~140 lines mimicking Tailwind) |
| **Deployment** | GitHub Pages via GitHub Actions |
| **Production deps** | react, react-dom (nothing else) |

Live at: https://guraltsev.github.io/make_your_own_tune/

---

## 2. Architecture & Organization

### 2.1 File structure

```
src/
  App.tsx        877 lines — all application logic
  main.tsx       11 lines  — React entry point
  index.css      140 lines — utility CSS classes
  App.css        (unused, Vite template artifact)
  assets/        (Vite template SVGs)

.github/workflows/
  deploy.yml         — GitHub Pages deployment
  deploy-pages.yml   — near-identical duplicate deployment workflow

make_your_own_tune_webapp.jsx — legacy pre-TypeScript copy at project root
```

### 2.2 Logical layers within App.tsx

The single file is organized into four sections, marked by comment headers:

1. **Wave math** (lines 17–121): Pure functions — `clamp`, `fract`, `pseudoNoise01`, `waveSample`, `makeWavePath`. These take wave parameters and produce sample values or SVG path strings.

2. **UI model** (lines 123–157): Type definitions (`WaveType`, `Slot`), tile metadata (`WAVE_TILES`), and formatting helpers (`formatHz`, `timeLabelForSlot`).

3. **Audio engine** (lines 169–477): Refs for AudioContext/WorkletNode/GainNode, lazy initialization (`ensureAudioContext`, `ensureWorklet`, `ensureSynthNode`), parameter scheduling via RAF, playback control with gain ramping, and cleanup. Includes the entire AudioWorklet processor as an inline JavaScript string (~130 lines).

4. **React component & UI** (lines 479–877): State declarations, memoized SVG paths, event handlers, and the full JSX layout (title bar, wave library, inspector plot, controls panel, timeline).

### 2.3 CSS approach

`src/index.css` manually defines ~80 utility classes (`.flex`, `.p-4`, `.bg-slate-50`, etc.) to replicate Tailwind's API without the framework. This is lightweight but means any class used in JSX that isn't manually defined silently does nothing.

### 2.4 CI/CD

Two GitHub Actions workflows exist for the same purpose (deploy to GitHub Pages on push to main). `deploy-pages.yml` is the more complete version (includes `workflow_dispatch` trigger and `actions/configure-pages`).

---

## 3. Strengths

### Clean type system
TypeScript strict mode is enabled. The `WaveType` union and `Slot` discriminated union (`kind: "empty" | "wave"`) provide compile-time safety. Refs, callbacks, and state are all properly typed. No `any` casts except the necessary `webkitAudioContext` fallback.

### Thoughtful audio engineering
The AudioWorklet implementation is well-designed for real-time synthesis:
- **Continuous phase oscillator** prevents clicks from phase resets.
- **Exponential smoothing** on frequency (10ms), amplitude (6ms), and wave shape (15ms) prevents zipper noise.
- **Crossfading** between old and new waveforms during shape changes eliminates discontinuities.
- **RAF-based parameter batching** prevents worklet message queue flooding during slider drags.
- **Lazy initialization** defers AudioContext creation until first user interaction, respecting browser autoplay policies.
- **Gain ramping** on play/stop/switch masks abrupt transitions.

### Self-contained AudioWorklet
The worklet processor is embedded as a Blob URL, avoiding the need for a separate JavaScript file and the associated build/deployment complexity. The Blob URL is properly revoked after loading.

### Effective memoization
`basePath` and `modifiedPath` use `useMemo` with correct dependency arrays — `basePath` only recomputes on `waveType` change, `modifiedPath` on `waveType`/`amp`/`freqHz` changes.

### Minimal dependency footprint
Only React and React DOM in production. No charting library, no audio library, no CSS framework. The app is self-contained and lightweight.

### Comprehensive documentation
The README covers what the app does, architecture, developer guide, core concepts, workflow recommendations, and a roadmap. This is unusually thorough for a project of this size.

### Deterministic pseudo-noise
The `pseudoNoise01` function uses `fract(sin(x * 127.1 + 311.7) * 43758.5453123)` for stable visual output across re-renders, avoiding the visual jitter that `Math.random()` would cause.

### Presentation-oriented UX
The three-stage workflow (Pick, Modify, Produce) is clear and guided. The layout works well for classroom projection with large text, clean spacing, and a logical flow.

---

## 4. Bugs & Issues

### 4.1 Missing CSS classes — `ring-2`, `ring-slate-900/10`, `transition`

**Location:** `src/App.tsx:584-586`

```tsx
"rounded-2xl border p-3 text-left shadow-sm transition " +
(selected
  ? "border-slate-900 ring-2 ring-slate-900/10 bg-slate-50"
  : ...)
```

The classes `ring-2`, `ring-slate-900/10`, and `transition` are not defined in `src/index.css`. This means:
- Selected wave tiles have **no ring indicator** — the visual difference between selected and unselected tiles is only a border color change, which is subtle.
- Tile hover/selection has **no animation** — state changes are instant rather than smooth.

**Impact:** Degraded visual feedback. Users may not clearly see which tile is selected.

### 4.2 Wave tile paths recomputed every render

**Location:** `src/App.tsx:569-577`

```tsx
{WAVE_TILES.map((w) => {
  const tilePath = makeWavePath({
    type: w.type, amp: 1, freqHz: 4, width: 160, height: 90,
    seconds: 1, samples: 120, yPad: 10,
  });
  ...
})}
```

`makeWavePath` is called 6 times on every render for tile previews with fixed parameters (`amp: 1`, `freqHz: 4`). These paths never change. Each call generates 121 SVG path points with string concatenation.

**Impact:** Unnecessary computation on every state change (slider drag, title edit, etc.).

### 4.3 Timeline mini paths recomputed every render

**Location:** `src/App.tsx:811-820`

Similar issue — `makeWavePath` is called inside `slots.map()` for every filled slot on every render. While the slot parameters can change when "Add here" is clicked, the paths are recomputed even when unrelated state (e.g., `freqHz` slider) changes.

**Impact:** Up to 5 additional unnecessary `makeWavePath` calls per render.

### 4.4 Duplicate CI workflows

**Location:** `.github/workflows/deploy.yml` and `.github/workflows/deploy-pages.yml`

Both trigger on push to `main` and deploy to GitHub Pages. They share the same concurrency group (`pages`), so one cancels the other, but this is confusing and wasteful (two builds start, one is killed).

**Impact:** Wasted CI minutes and confusing workflow history.

### 4.5 Stale legacy file

**Location:** `make_your_own_tune_webapp.jsx` (project root)

This is the pre-TypeScript version of the app. It duplicates the content of `src/App.tsx` but as JSX with React imports. It's not referenced by any build config or import.

**Impact:** Confusing for contributors; may be mistaken for the active source.

### 4.6 Frequency slider uses linear scale

**Location:** `src/App.tsx:742-748`

```tsx
<input type="range" min={40} max={2000} step={1} value={freqHz} ... />
```

Human pitch perception is logarithmic. With a linear slider over 40–2000 Hz, the range 40–200 Hz (where pitch differences are most perceptible) occupies only 8% of the slider width, while 1000–2000 Hz (where adjacent Hz values sound nearly identical) occupies 51%.

**Impact:** Fine-tuning at low frequencies is difficult; the slider feels unresponsive at high frequencies.

---

## 5. Points of Friction

### 5.1 Monolithic single file

All application logic — math utilities, type definitions, ~130 lines of AudioWorklet JavaScript, audio lifecycle management, and the entire UI — lives in one 877-line file. While the README explicitly recommends this for simplicity, it becomes harder to navigate as the app grows. There are no importable/testable modules.

### 5.2 Duplicated waveform logic

Wave sampling is implemented twice:
- TypeScript: `waveSample()` at `src/App.tsx:39-81`
- AudioWorklet inline JS: `_sampleWave()` at `src/App.tsx:263-285`

The implementations are semantically identical but syntactically different (one uses `tSec`/`freqHz` parameters, the other uses pre-computed `phase`). Any change to waveform behavior must be manually synchronized between the two. There's no mechanism to catch drift.

### 5.3 Inline worklet loses tooling

The AudioWorklet code is a JavaScript string inside a TypeScript template literal. This means:
- No TypeScript type checking on the worklet code
- No ESLint coverage
- No IDE autocomplete, go-to-definition, or refactoring support
- Syntax errors only surface at runtime when the worklet fails to load

### 5.4 No tests

There are zero test files and no testing framework in `devDependencies`. The wave math functions (`waveSample`, `makeWavePath`, `pseudoNoise01`) are pure functions with clear input/output contracts — ideal for unit testing but untested.

### 5.5 Custom CSS with coverage gaps

The hand-rolled utility CSS in `index.css` covers ~80 classes but silently omits others used in JSX (`ring-2`, `ring-slate-900/10`, `transition`). There's no build-time check for undefined classes. Each new UI feature may require adding CSS rules manually.

### 5.6 No state persistence

All state (title, wave selection, slider values, timeline slots) is held in React `useState` and lost on page refresh. For a presentation tool, this means re-configuring everything each session.

### 5.7 Timeline cannot be played back

Users can populate the 5-slot timeline but cannot hear the composed result. There's no play/sequencing functionality and no audio export. The timeline is purely visual.

### 5.8 No accessibility support

- SVG plot elements have no ARIA labels (only `aria-label="Wave plot"` on the container)
- Wave tiles and timeline buttons lack `aria-label` or `role` attributes
- No keyboard navigation between tiles or timeline slots
- No focus indicators styled
- No screen reader announcements for playback state changes

### 5.9 Silent error handling

All `try/catch` blocks (lines 331, 400, 405, 470) use empty catches. If AudioContext initialization fails (e.g., browser policy, hardware issue), the user sees no feedback — clicking curves simply does nothing.

---

## 6. Future Development Directions

### Quick wins

| Change | Effort | Effect |
|--------|--------|--------|
| Delete `deploy.yml` (keep `deploy-pages.yml`) | Trivial | Eliminates duplicate CI builds |
| Delete `make_your_own_tune_webapp.jsx` | Trivial | Removes dead code |
| Add `ring-2`, `ring-slate-900/10`, `transition` to `index.css` | Small | Fixes selected tile visual feedback |
| Memoize tile paths (compute once at module scope or with `useMemo`) | Small | Eliminates 6 unnecessary path computations per render |
| Logarithmic frequency slider | Small | More natural pitch control |
| `localStorage` persistence for state | Small | Survive page refreshes |
| Keyboard shortcuts (space = play, 1-6 = wave selection) | Small | Faster interaction during presentations |
| ARIA labels on interactive elements | Small | Basic accessibility |

### Medium projects

| Project | Description |
|---------|-------------|
| **Module extraction** | Split `App.tsx` into `wave-math.ts`, `audio-engine.ts`, `worklet-processor.ts` (as a real file built by Vite), and UI component files. Eliminates code duplication between visualization and audio wave sampling. |
| **Timeline playback** | Add a play button that sequences through filled slots, playing each for 2 seconds. Use the existing AudioWorklet infrastructure — post new parameters at each 2-second boundary. |
| **Audio export** | Render timeline to WAV using `OfflineAudioContext`. The worklet already runs offline-compatible code. |
| **Unit tests** | Add Vitest (Vite-native, zero config). Test `waveSample`, `makeWavePath`, `formatHz`, `timeLabelForSlot`, and slot state logic. |
| **Responsive layout** | The current layout assumes wide screens (360px left + 320px controls = 680px minimum). Add stacked mobile layout. |
| **Slot editing** | Click a filled slot to load its parameters back into the controls. Currently slots are write-only. |

### Large-scale projects

| Project | Description |
|---------|-------------|
| **ADSR envelope editor** | Add visual attack/decay/sustain/release controls per slot. Apply envelope shaping in the worklet's amplitude path. |
| **Audio effects chain** | Insert Web Audio API nodes (BiquadFilterNode, DelayNode, ConvolverNode) between the worklet and destination. Add UI controls for filter cutoff, resonance, delay time, reverb mix. |
| **Fourier decomposition view** | Show a live frequency spectrum (FFT via AnalyserNode) alongside the time-domain plot. Visually demonstrate how square waves contain odd harmonics, etc. |
| **Custom waveform drawing** | Let users draw arbitrary waveforms via SVG mouse/touch interaction. Convert to a periodic wavetable for playback using `PeriodicWave`. |
| **Multi-track composition** | Multiple parallel timelines with independent wave settings and a mixer. Would require significant state management refactoring. |
| **Collaborative mode** | Real-time shared sessions via WebSocket for classroom use. Multiple students modify parameters simultaneously on a shared projection. |
| **Recording & sharing** | Record composed audio and generate shareable links or downloadable files. Could use MediaRecorder API on the AudioContext destination. |
