# Make Your Own Tune

An interactive web app for exploring the **math and sound of waveforms** in a presentation-friendly interface.

---

## Table of Contents

- [Webpage Link](#webpage-link)
- [Summary of What the Webpage Does](#summary-of-what-the-webpage-does)
- [Detailed Description of What the Webpage Does](#detailed-description-of-what-the-webpage-does)
  - [1) Presentation-style top-level layout](#1-presentation-style-top-level-layout)
  - [2) Wave library (selection stage)](#2-wave-library-selection-stage)
  - [3) Wave inspector (modification stage)](#3-wave-inspector-modification-stage)
  - [4) Timeline producer (composition stage)](#4-timeline-producer-composition-stage)
  - [5) Signal generation and visualization model](#5-signal-generation-and-visualization-model)
  - [6) Audio synthesis model](#6-audio-synthesis-model)
- [Architecture / Design / Developer Guide](#architecture--design--developer-guide)
- [Where the main code lives (and how to edit it)](#where-the-main-code-lives-and-how-to-edit-it)
- [Tech stack](#tech-stack)
- [High-level architecture](#high-level-architecture)
- [Repository structure](#repository-structure)
- [Core concepts for developers](#core-concepts-for-developers)
  - [1) Wave math helpers](#1-wave-math-helpers)
  - [2) State model](#2-state-model)
  - [3) Audio lifecycle](#3-audio-lifecycle)
  - [4) Parameter update strategy](#4-parameter-update-strategy)
  - [5) Timeline data strategy](#5-timeline-data-strategy)
- [Local development](#local-development)
- [Developer workflow recommendations](#developer-workflow-recommendations)
- [Suggested next improvements](#suggested-next-improvements)
- [License](#license)

---

## Webpage Link

- **Github Pages URL:** https://guraltsev.github.io/make_your_own_tune/

---

## Summary of What the Webpage Does

This webpage lets users:

1. **Choose a waveform** from a built-in library (sine, triangle, square, sawtooth, noise, and humps).
2. **Modify amplitude and frequency** with sliders.
3. **Visually compare** a base reference wave (220 Hz, amplitude 1) against a modified wave in an overlay plot.
4. **Hear the waveforms** by clicking either plotted curve (2-second playback).
5. **Build a 10-second timeline** by placing current waveform settings into five 2-second slots.

In short, it is an educational and demonstration tool for understanding how waveform shape, frequency, and amplitude affect signal appearance and sound.

---

## Detailed Description of What the Webpage Does

### 1) Presentation-style top-level layout

The app is intentionally designed like a guided workflow:

- **Step 1 (left panel):** Pick a wave.
- **Step 2 (upper-right):** Modify and inspect the signal.
- **Step 3 (lower-right):** Produce a simple timeline composition.

A title bar at the top includes:

- A presentation badge/icon.
- Editable presentation title (e.g., “Math of Sound Waves”).
- A compact instruction cue (“Select → Modify → Produce”).

This makes it usable both as a teaching aid and as a standalone interactive demo.

### 2) Wave library (selection stage)

The wave library displays six selectable waveform tiles:

- **Sine** (smooth)
- **Triangle** (linear ramps)
- **Square** (rich harmonics)
- **Sawtooth** (bright)
- **Noise** (random)
- **Humps** (envelope-shaped visual pattern)

Each tile includes:

- A label and subtitle.
- A mini SVG preview of the waveform.
- A selected/unselected state marker.

When users choose a tile, the selected waveform drives both the inspector visualization and the audio synthesis behavior.

### 3) Wave inspector (modification stage)

The inspector overlays two curves on one coordinate system:

- **Base wave:** fixed at 220 Hz and amplitude 1.
- **Modified wave:** uses the currently selected waveform type and slider values.

#### Controls

- **Amplitude slider:** 0.00 to 2.00
- **Frequency slider:** 40 Hz to 2000 Hz
- **Reset to 220 Hz** button
- **Reset all** button (restores amplitude and frequency defaults)

#### Visual behavior

- The chart window shows approximately **20 ms** of waveform data.
- The plot includes axis references and labels.
- Line thickness increases for the currently playing curve, giving users immediate playback feedback.

#### Playback behavior

Clicking either curve starts a short (2-second) audio preview:

- Clicking the base curve plays base parameters.
- Clicking the modified curve plays current modified parameters.
- Switching playback between curves uses a fast gain dip and smooth ramp to reduce audible clicks.
- Playback auto-stops after 2 seconds.

### 4) Timeline producer (composition stage)

The bottom panel provides a **5-slot timeline**:

- Each slot represents **2 seconds**.
- Total length represented is **10 seconds**.
- Users can click **“Add here”** to copy the current modified waveform settings into that slot.
- Each filled slot shows:
  - A mini waveform preview.
  - Time range label (e.g., 0–2s, 2–4s).
  - A compact descriptor (wave type and frequency).
- A **Clear** button resets all slots to empty.

This timeline is currently a visual composition model (not exported audio), useful for planning or demonstrating structure.

### 5) Signal generation and visualization model

The app computes wave samples using deterministic math functions:

- Sine, square, triangle, sawtooth, noise-like pseudo-random sampling, and a custom “humps” profile.
- Paths are generated as SVG polyline/path data by sampling signal values across a chosen time window.
- Amplitude is clamped/scaled to keep rendering stable and within plot bounds.

### 6) Audio synthesis model

Audio is produced through the Web Audio API using an `AudioWorklet`:

- A custom `WaveSynthProcessor` maintains continuous oscillator phase.
- Frequency and amplitude are smoothed with short time constants to avoid zipper noise.
- Wave-shape switching crossfades between old/new wave forms to reduce clicks.
- Noise is generated with lightweight pseudo-random sample-and-hold logic for less harsh output.

This design gives responsive interactivity while maintaining presentation-friendly audio smoothness.

---

## Architecture / Design / Developer Guide

## Where the main code lives (and how to edit it)

If you want to make quick changes, most of the app behavior is in:

- `src/App.tsx` — main UI layout, waveform logic, and audio interactions.
- `src/main.tsx` — app entry point.
- `src/index.css` — global styles.

### Easiest edit workflow: GitHub Codespaces

1. Open this repository on GitHub.
2. Click **Code** → **Codespaces** → **Create codespace on main** (or your working branch).
3. In the Codespaces terminal, install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

4. Edit files (usually `src/App.tsx`) and use the preview/browser to verify changes.
5. Commit and push from Codespaces, then open a pull request.

If you prefer local development, the same commands (`npm install`, `npm run dev`) work in any Node.js environment.

## Tech stack

- **UI:** React 19 + TypeScript
- **Build tool:** Vite
- **Audio:** Web Audio API (`AudioContext`, `AudioWorkletNode`, `GainNode`)
- **Styling:** Utility-first class usage in JSX (Tailwind-like class names), plus base CSS files

## High-level architecture

The app is currently a single-page, client-only application with one main feature component.

### Runtime flow

1. App initializes state (title, selected wave, amplitude, frequency, timeline slots).
2. User interactions update React state.
3. Derived waveform paths are recomputed with memoization.
4. UI re-renders previews and overlays.
5. If playback is active, parameter updates are sent to the audio worklet.
6. Timeline slots store snapshots of current wave parameters.

## Repository structure

```text
.
├── src/
│   ├── App.tsx        # Main application logic/UI/audio integration
│   ├── App.css        # Base CSS from Vite template (mostly not used by core UI)
│   ├── index.css      # Global styles/bootstrap imports
│   └── main.tsx       # React entry point
├── index.html         # HTML template
├── package.json       # Scripts and dependencies
├── vite.config.ts     # Vite configuration
└── README.md          # Project documentation
```

## Core concepts for developers

### 1) Wave math helpers

The app uses utility helpers for:

- Clamping numeric ranges.
- Fractional-part extraction.
- Deterministic pseudo-noise generation.
- Sample generation by wave type.
- SVG path construction from sampled data.

If you add new wave types, update:

- The wave type union.
- The wave tile metadata list.
- The waveform sample function.
- (Optionally) audio worklet wave sampling logic for consistency.

### 2) State model

Main state domains:

- **Presentation state:** title.
- **Wave selection and controls:** wave type, amplitude, frequency.
- **Playback state:** active variant (`base` or `modified`) and audio node refs.
- **Timeline state:** five slot objects with either empty or wave config snapshots.

### 3) Audio lifecycle

The audio system is initialized lazily:

- `AudioContext` is created on first play interaction.
- Worklet module is generated from inline source and registered once.
- Synth node and master gain are created and connected on demand.
- Stop/cleanup logic fades out and disconnects nodes.

This approach avoids unnecessary audio initialization cost before user action.

### 4) Parameter update strategy

During playback, slider or wave changes should update sound quickly but smoothly:

- UI updates are batched through `requestAnimationFrame` before posting to the worklet.
- The processor applies exponential smoothing per sample block.
- Crossfading between wave shapes prevents abrupt discontinuities.

### 5) Timeline data strategy

Timeline slots intentionally store **parameter snapshots** (type, amplitude, frequency, label), not audio buffers.

Benefits:

- Lightweight memory usage.
- Fast redraw.
- Simple behavior for educational demos.

Future enhancements could render actual audio segments from the slot data.

## Local development

### Install

```bash
npm install
```

### Run development server

```bash
npm run dev
```

Open the app at `http://localhost:5173`.

### Build for production

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

## Developer workflow recommendations

- Keep waveform math deterministic for stable visual previews.
- Keep audio transitions smoothed to minimize clicks.
- Prefer `useMemo` for expensive waveform path generation.
- Keep slot payloads compact (store parameters, derive visuals/audio when needed).
- If splitting `App.tsx`, separate concerns into:
  - Wave math utilities
  - Audio engine/worklet glue
  - Presentational panels/components
  - Timeline domain logic

## Suggested next improvements

- Export timeline as actual audio.
- Add transport controls (play timeline from slot 1→5).
- Add envelope controls (ADSR).
- Add filters/effects (low-pass, delay, reverb).
- Persist sessions in local storage.
- Add keyboard shortcuts and accessibility labels.
- Add unit tests for wave math and path generation.

---

## License

See [LICENSE](./LICENSE).
