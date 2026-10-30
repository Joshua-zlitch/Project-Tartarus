# Project Tartarus — 2.5D Pixel Art AI Agent Workspace & Desktop Boilerplate

Project Tartarus is a native desktop application architecture and interactive live workspace where AI coding agents operate inside a 2.5D top-down pixel-art circular arena powered by Phaser.js, React, Tauri v2, and a real-time Python FastAPI WebSocket backend packaged via PyInstaller.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX choices were confirmed during interactive clarification and govern both the live interactive workspace and the generated boilerplate blueprints.

- **Confirmed Presentation Layout**: Full-screen Phaser 2.5D circular arena canvas with a floating code and terminal command drawer so you can inspect and copy the exact Tauri, React, and Python boilerplate files while interacting with the live arena.
- **Confirmed WebSocket Testing Workflow**: Live WebSocket client logic (`ws://127.0.0.1:8000/ws`) paired with an interactive Event Injector panel that lets you dispatch and test real-time agent WebSocket payloads (`agent_spawn`, `agent_move`, `agent_state`, `task_progress`) directly in the browser preview or against a local FastAPI server.
- **Confirmed Desktop & Backend Packaging**: Tauri v2 sidecar binary configuration (`externalBin`) paired with a PyInstaller `--onefile` build specification so the FastAPI/Uvicorn server compiles into a standalone executable bundled cleanly inside the lightweight Windows `.exe` installer.

---

## 1. Overview & Core Concept

- **What It Does**: Provides both a live, interactive Phaser.js 2.5D circular arena workspace and the complete, copy-ready multi-language boilerplate (terminal scaffolding commands, `main.jsx`, `App.jsx`, `main.py`, Tauri v2 sidecar configuration, and PyInstaller build workflow) required to compile Project Tartarus into a native desktop `.exe`.
- **Target Audience / Persona**: Desktop systems engineers and AI agent developers building visual, game-inspired spatial interfaces for multi-agent orchestration.
- **Key Value**: Bridges a lightweight Rust/Tauri native window and an embedded Phaser 2D/2.5D WebGL/Canvas engine with a Python FastAPI WebSocket server—eliminating Electron bloat while maintaining full access to Python's AI ecosystem.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Live 2.5D Circular Arena Exploration**: Upon opening the application, the viewport renders a full-screen Phaser.js scene featuring an isometric/2.5D top-down pixel-art circular stone arena with concentric floor rings, pixel grid alignment, and interactive camera pan/zoom controls.
2. **Real-Time WebSocket & Event Injector Flow**: A floating **Event Injector & Connection Dock** on the left allows connecting to a live local FastAPI server (`ws://127.0.0.1:8000/ws`) or dispatching structured JSON agent events (`spawn_agent`, `move_agent`, `code_action`, `arena_pulse`) directly into the same message handler used by the WebSocket listener, spawning and animating pixel-art agent sprites inside the circular arena.
3. **Floating Boilerplate & Terminal Command Drawer**: Clicking **Open Boilerplate & Commands** slides over a structured developer drawer containing copyable PowerShell/Bash scaffolding commands (Frontend Tauri/Vite setup, Python `venv` & FastAPI setup, PyInstaller `--onefile` sidecar packaging) and syntax-highlighted, copy-ready source tabs for `main.jsx`, `App.jsx`, `main.py`, and `tauri.conf.json`.

### Visual Identity & Theme
- **Aesthetic Direction**: Utilitarian dark workbench paired with crisp 2.5D pixel-art subterranean arena geometry ("Tartarus" obsidian stone, ember accents, and sharp pixel-aligned HUD overlays).
- **Color Palette & Mood (60-30-10 Discipline)**:
  - *60% Dominant Neutral Canvas*: Deep obsidian slate (`#0B0F17`) surrounding the Phaser arena viewport and dark slate stone floor tiles (`#131B2E`).
  - *30% Structural Surfaces*: Translucent obsidian HUD panels (`#111827` at 90% opacity) with crisp `1px solid #1E293B` hairline borders and muted slate text (`#94A3B8`).
  - *10% Accent Budget*: Tartarus forge amber (`#F59E0B`) for primary interactive buttons and active tabs, paired with semantic connection indicators (`#10B981` nominal/connected, `#EF4444` disconnected/error).
- **Typography & Hierarchy (2+1 Font Rule)**:
  - *Display / Brand Header*: `Outfit` (SemiBold 600, tight tracking) for workspace headings and drawer titles.
  - *Body & UI Controls*: `Plus Jakarta Sans` (Regular 400 / Medium 500) for clean, high-contrast scannability.
  - *Code, Terminal Commands & Telemetry*: `JetBrains Mono` with `tabular-nums` for WebSocket JSON payloads, coordinates, and boilerplate code blocks.
- **Component Styling & Layout**:
  - Top bar strictly follows the three-zone contract: Brand wordmark (`Project Tartarus`) on the left, concise workspace navigation links in the center (`Arena Canvas`, `Event Log`, `Architecture`, `Packaging Guide`), and one primary action button (`Open Boilerplate & Commands`) on the right.
  - Floating HUD panels maintain a minimum `16px` internal padding, single-level card elevation, and unboxed metadata separated by middle dots (`·`).

### Interactive Feedback & Motion
- Instant visual feedback ($\le 150\text{ms}$) on button presses, one-click clipboard copy confirmation states (`Copied to clipboard`), and smooth Phaser tween animations as AI coding agents move to target polar/Cartesian coordinates inside the circular arena.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Direct React-to-Phaser Ref Bridge via Custom Event Bus**
  - *Chosen Approach*: Embed the `Phaser.Game` instance inside a dedicated React `useEffect` lifecycle hook (`useRef` container) and pass incoming WebSocket JSON events into the active Phaser Scene via an internal event emitter / scene method call.
  - *Why*: Prevents React re-renders from destroying and recreating the WebGL/Canvas context on every WebSocket message while keeping connection state synchronized in React HUD overlays.
  - *Alternatives Considered*: Storing Phaser game objects in React state (causes severe frame drops and canvas re-initialization).
- **Decision 2: Tauri v2 Sidecar + PyInstaller `--onefile` Packaging**
  - *Chosen Approach*: Package `main.py` (FastAPI + Uvicorn) with PyInstaller (`--onefile --noconsole --name tartarus-backend`) and register the target-triple binary under `bundle.externalBin` in Tauri v2 so the desktop app manages the Python server lifecycle automatically.
  - *Why*: Produces a self-contained Windows `.exe` without requiring end users to install Python, virtualenv, or Uvicorn on their machine.
  - *Alternatives Considered*: Requiring manual terminal startup of Python alongside the `.exe` (fragile end-user experience).

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   TAURI v2 NATIVE DESKTOP SHELL (.exe)                     │
│                                                                            │
│  ┌───────────────────────────────────────┐    WebSocket (ws://127.0.0.1:8000/ws)
│  │      REACT + VITE FRONTEND            │◄─────────────────────────────┐  │
│  │                                       │                              │  │
│  │  ┌─────────────────────────────────┐  │  ┌────────────────────────┐  │  │
│  │  │ Top Bar (3-Zone Navigation)     │  │  │Event Injector & WS Dock│  │  │
│  │  └─────────────────────────────────┘  │  └───────────┬────────────┘  │  │
│  │                                       │              │               │  │
│  │  ┌─────────────────────────────────┐  │              ▼               │  │
│  │  │ Phaser.js 2.5D Circular Arena   │◄─┴──── Scene Event Bridge       │  │
│  │  │ - Pixel Art Stone Ring Geometry │                                 │  │
│  │  │ - Autonomous Coding Agent Nodes │  ┌───────────────────────────┐  │  │
│  │  └─────────────────────────────────┘  │  │ Floating Drawer        │  │  │
│  │                                       │  │ - CLI Setup Commands   │  │  │
│  │                                       │  │ - main.jsx / App.jsx   │  │  │
│  │                                       │  │ - main.py / Tauri Spec │  │  │
│  │                                       │  └───────────────────────────┘  │
│  └───────────────────────────────────────┘                              │  │
│                                                                         ▼  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │          PYTHON FASTAPI + UVICORN SIDECAR (PyInstaller .exe)         │  │
│  │  - ConnectionManager (active WebSockets broadcast)                   │  │
│  │  - /ws Endpoint (bi-directional JSON agent event stream)             │  │
│  │  - PyInstaller __main__ multiprocessing & Uvicorn programmatic entry │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & WebSocket Event Protocol
- **Agent Entity**: `{ id: string, name: string, role: string, state: 'idle' | 'coding' | 'reviewing' | 'moving', x: number, y: number, color: string, task?: string }`
- **WebSocket Message Payload**:
  - `type`: `'init_arena' | 'agent_spawn' | 'agent_move' | 'agent_state' | 'arena_reset'`
  - `agent`: Agent entity object or delta coordinates (`x`, `y` constrained within the circular arena radius $R$)
  - `timestamp`: ISO-8601 string

### Interactive Component & State Mapping
- **Phaser Circular Arena Scene (`TartarusArenaScene`)**: Renders the 2.5D perspective circular stone platform (foreshortened ellipse/isometric depth rim, pixel grid, torch/ember perimeter markers, and animated pixel-art agent sprites). Supports click-to-move or click-to-inspect an agent inside the arena, plus zoom/pan reset controls.
- **WebSocket & Event Injector Panel**:
  - Maintains live WebSocket connection status (`Connected`, `Connecting`, `Local Test Mode`) with reconnect trigger and custom URL input (`ws://127.0.0.1:8000/ws`).
  - Provides one-click preset buttons (`Spawn Coding Agent`, `Move Random Agent`, `Trigger Code Task`, `Clear Arena`) and a custom JSON payload editor that validates and dispatches events directly into the WebSocket/Phaser handler.
- **Floating Code & Command Drawer**:
  - **Terminal Commands Tab**: Step-by-step copyable blocks for (1) Scaffolding React + Vite + Phaser + Tauri v2, (2) Creating the Python `venv` and installing `fastapi`, `uvicorn[standard]`, `websockets`, and `pyinstaller`, and (3) Building the PyInstaller sidecar executable and compiling the Tauri `.exe`.
  - **Source Code Tabs (`main.jsx`, `App.jsx`, `main.py`, `tauri.conf.json`)**: Complete, copy-ready source files matching the exact requested architecture with one-click copy buttons.
