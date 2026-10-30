export interface CommandSection {
  id: string;
  stepNumber: string;
  title: string;
  subtitle: string;
  osVariant: 'windows' | 'unix' | 'both';
  commands: string;
  notes: string;
}

export interface CodeFileItem {
  id: string;
  filename: string;
  filepath: string;
  language: string;
  description: string;
  code: string;
}

export const TERMINAL_COMMANDS: CommandSection[] = [
  {
    id: 'step-1-dotenv-gemini',
    stepNumber: '01.',
    title: 'Configure .env & Install google-generativeai + python-dotenv',
    subtitle: 'Securely stores GEMINI_API_KEY in backend/.env and installs the Gemini SDK for the Zeus Orchestrator.',
    osVariant: 'both',
    commands: `# 1. Activate the Python virtual environment inside /backend
cd backend
.\\.venv\\Scripts\\Activate.ps1
# (Or on macOS/Linux: source .venv/bin/activate)

# 2. Install FastAPI, Uvicorn (WebSockets), Google Generative AI SDK, python-dotenv, and PyInstaller
pip install --upgrade pip
pip install fastapi "uvicorn[standard]" websockets google-generativeai python-dotenv pyinstaller

# 3. Create backend/.env and add your GEMINI_API_KEY (never commit .env to git)
echo GEMINI_API_KEY="YOUR_ACTUAL_GEMINI_API_KEY" > .env

# 4. Run the FastAPI WebSocket + Gemini server on ws://127.0.0.1:8000/ws
python main.py`,
    notes: 'main.py calls load_dotenv() to load GEMINI_API_KEY from backend/.env (or from the directory next to the compiled PyInstaller .exe).'
  },
  {
    id: 'step-2-pyinstaller',
    stepNumber: '02.',
    title: 'Compile Python FastAPI + Gemini Server via PyInstaller for Tauri externalBin',
    subtitle: 'Compiles main.py into the single-file executable expected by Tauri v2 bundle.externalBin ("binaries/tartarus-backend").',
    osVariant: 'windows',
    commands: `# Run inside /backend with .venv active
pyinstaller --onefile --noconsole --clean ^
  --hidden-import=uvicorn.logging ^
  --hidden-import=uvicorn.loops.auto ^
  --hidden-import=uvicorn.protocols.http.auto ^
  --hidden-import=uvicorn.protocols.websockets.auto ^
  --hidden-import=uvicorn.lifespan.on ^
  --hidden-import=google.generativeai ^
  --hidden-import=dotenv ^
  --distpath ../src-tauri/binaries ^
  --name tartarus-backend-x86_64-pc-windows-msvc main.py

# Place your .env file next to the compiled binary or in the project root:
# copy .env ..\\src-tauri\\binaries\\.env`,
    notes: 'Tauri v2 requires externalBin binaries inside src-tauri/binaries/ to append the host target triple (run "rustc -Vv" to inspect the "host:" line).'
  },
  {
    id: 'step-3-frontend',
    stepNumber: '03.',
    title: 'Scaffold React + Vite + Phaser.js + Tauri v2 Frontend',
    subtitle: 'Initializes the Vite React workspace, installs Phaser 3, and attaches the Rust Tauri v2 desktop wrapper.',
    osVariant: 'both',
    commands: `# 1. Create project root and scaffold Vite React project
mkdir project-tartarus && cd project-tartarus
npm create vite@latest . -- --template react

# 2. Install frontend runtime dependencies (Phaser 3 & Tauri Shell plugin)
npm install
npm install phaser @tauri-apps/api @tauri-apps/plugin-shell

# 3. Install Tauri v2 CLI and initialize the Rust desktop shell (src-tauri/)
npm install -D @tauri-apps/cli@latest
npx tauri init --app-name "Project Tartarus" --window-title "Project Tartarus" --dist-dir "../dist" --dev-path "http://localhost:5173"`,
    notes: 'Ensure Rust (rustup) and C++ Build Tools for Visual Studio are installed on Windows so cargo can compile the native .exe.'
  }
];

export const BOILERPLATE_FILES: CodeFileItem[] = [
  {
    id: 'main-py',
    filename: 'main.py',
    filepath: 'backend/main.py',
    language: 'python',
    description: 'FastAPI WebSocket server integrating google-generativeai & python-dotenv for the Zeus orchestrator.',
    code: `"""
Project Tartarus — Complete FastAPI + WebSockets Backend (main.py)
Integrates google-generativeai and python-dotenv for the Zeus Orchestrator:
1. Loads GEMINI_API_KEY securely from .env via python-dotenv.
2. When zeus_task is received, passes the user's text string to Gemini with the system instruction:
   'You are Zeus. Analyze the task and return a strict JSON array of required agents based on these roles:
   hephaestus (database/backend), helios (frontend), hades (systems/security), poseidon (API/network).'
3. Parses the LLM's JSON array response in the backend.
4. Loops through the returned array and broadcasts an agent_spawn WebSocket event for each selected agent.
"""

import os
import sys
import re
import math
import json
import random
import asyncio
import multiprocessing
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

from dotenv import load_dotenv
import google.generativeai as genai
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn


# 1. Securely load GEMINI_API_KEY from .env (supports local dev & frozen PyInstaller .exe)
def load_environment() -> Optional[str]:
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        load_dotenv(exe_dir / ".env")

    backend_dir = Path(__file__).resolve().parent
    load_dotenv(backend_dir / ".env")
    load_dotenv(backend_dir.parent / ".env")
    load_dotenv()
    return os.getenv("GEMINI_API_KEY")


GEMINI_API_KEY = load_environment()

ZEUS_SYSTEM_INSTRUCTION = (
    "You are Zeus. Analyze the task and return a strict JSON array of required agents "
    "based on these roles: hephaestus (database/backend), helios (frontend), "
    "hades (systems/security), poseidon (API/network), athena (conversational/chat). "
    "If the user's prompt is conversational, general knowledge, a greeting, or non-technical "
    "(not related to databases, frontends, or networking), you must output [\\"athena\\"] in your strict JSON array."
)

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Pre-initialize model with response_mime_type="application/json" for maximum speed
ZEUS_MODEL = genai.GenerativeModel(
    model_name=os.getenv("GEMINI_MODEL", "gemini-1.5-flash"),
    system_instruction=ZEUS_SYSTEM_INSTRUCTION,
    generation_config={"response_mime_type": "application/json"},
)

ARENA_RADIUS = 250
MAX_AGENT_RADIUS = ARENA_RADIUS - 26

PANTHEON_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "zeus": {
        "id": "agent-zeus",
        "name": "Zeus",
        "role": "Orchestrator",
        "state": "orchestrating",
        "color": "#FEF08A",
    },
    "hephaestus": {
        "id": "agent-hephaestus",
        "name": "Hephaestus",
        "role": "Database & Backend",
        "state": "coding",
        "color": "#F59E0B",
    },
    "helios": {
        "id": "agent-helios",
        "name": "Helios",
        "role": "Frontend",
        "state": "coding",
        "color": "#EAB308",
    },
    "hades": {
        "id": "agent-hades",
        "name": "Hades",
        "role": "Systems & Security",
        "state": "reviewing",
        "color": "#A855F7",
    },
    "poseidon": {
        "id": "agent-poseidon",
        "name": "Poseidon",
        "role": "API & Network",
        "state": "moving",
        "color": "#38BDF8",
    },
    "athena": {
        "id": "agent-athena",
        "name": "Athena",
        "role": "Conversational / Chat",
        "state": "reviewing",
        "color": "#22D3EE",
    },
}

VALID_SPECIALIST_KEYS = {"hephaestus", "helios", "hades", "poseidon", "athena"}


def clamp_to_circular_arena(x: float, y: float) -> tuple[int, int]:
    dist = math.hypot(x, y)
    if dist > MAX_AGENT_RADIUS and dist > 0:
        scale = MAX_AGENT_RADIUS / dist
        return round(x * scale), round(y * scale)
    return round(x), round(y)


def random_arena_coordinates(min_r: int = 55, max_r: int = 210) -> tuple[int, int]:
    angle = random.uniform(0, 2 * math.pi)
    radius = random.uniform(min_r, min(max_r, MAX_AGENT_RADIUS))
    return round(math.cos(angle) * radius), round(math.sin(angle) * radius)


def parse_llm_json_agent_array(raw_text: str) -> List[str]:
    """Parses the Gemini LLM response into a validated list of Pantheon role keys."""
    cleaned = raw_text.strip()
    if not cleaned.startswith("["):
        bracket_match = re.search(r"\\[.*\\]", cleaned, flags=re.DOTALL)
        if bracket_match:
            cleaned = bracket_match.group(0)

    parsed = json.loads(cleaned)
    if not isinstance(parsed, list):
        raise ValueError("LLM response is not a JSON array.")

    selected_keys: List[str] = []
    for item in parsed:
        key = str(item).strip().lower().replace("agent-", "")
        if key in VALID_SPECIALIST_KEYS and key not in selected_keys:
            selected_keys.append(key)

    return selected_keys


def _sync_generate_json(task_prompt: str) -> str:
    response = ZEUS_MODEL.generate_content(
        task_prompt,
        generation_config={"response_mime_type": "application/json"},
    )
    return response.text


async def analyze_task_with_gemini_async(task_prompt: str) -> List[str]:
    """Strictly non-blocking Gemini LLM call using generate_content_async with asyncio.to_thread fallback."""
    api_key = os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in .env")

    try:
        response = await ZEUS_MODEL.generate_content_async(
            task_prompt,
            generation_config={"response_mime_type": "application/json"},
        )
        raw_text = response.text
    except Exception:
        raw_text = await asyncio.to_thread(_sync_generate_json, task_prompt)

    selected_agents = parse_llm_json_agent_array(raw_text)
    return selected_agents or ["athena"]


app = FastAPI(title="Project Tartarus — Zeus Gemini Orchestrator Server", version="1.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self.agents: Dict[str, Dict[str, Any]] = {}
        self.background_tasks: set[asyncio.Task[Any]] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        await websocket.send_text(json.dumps({
            "type": "init_arena",
            "agents": list(self.agents.values()),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }))

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        if not self.active_connections:
            return
        serialized = json.dumps(payload)
        connections = list(self.active_connections)
        results = await asyncio.gather(
            *(conn.send_text(serialized) for conn in connections),
            return_exceptions=True,
        )
        for conn, result in zip(connections, results):
            if isinstance(result, Exception):
                self.disconnect(conn)

    async def broadcast_zeus_orchestrating(self, clean_prompt: str) -> None:
        zeus_spec = PANTHEON_TEMPLATES["zeus"]
        zeus_existing = self.agents.get("agent-zeus")
        zeus_agent = {
            "id": "agent-zeus",
            "name": zeus_spec["name"],
            "role": zeus_spec["role"],
            "state": "orchestrating",
            "x": zeus_existing["x"] if zeus_existing else 0,
            "y": zeus_existing["y"] if zeus_existing else 0,
            "color": zeus_spec["color"],
            "task": f"Orchestrating: {clean_prompt}",
        }
        self.agents["agent-zeus"] = zeus_agent
        await self.broadcast({
            "type": "agent_spawn" if not zeus_existing else "agent_state",
            "agent": zeus_agent,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    async def _resolve_llm_and_dispatch_spawns(self, clean_prompt: str) -> None:
        selected_role_keys = await analyze_task_with_gemini_async(clean_prompt)

        spawn_timestamp = datetime.now(timezone.utc).isoformat()
        spawn_tasks = []
        for role_key in selected_role_keys:
            spec = PANTHEON_TEMPLATES.get(role_key)
            if not spec:
                continue
            agent_id = spec["id"]
            rx, ry = random_arena_coordinates()
            spawned = {
                "id": agent_id,
                "name": spec["name"],
                "role": spec["role"],
                "state": spec["state"],
                "x": rx,
                "y": ry,
                "color": spec["color"],
                "task": f"Dispatched by Zeus: {clean_prompt}",
            }
            self.agents[agent_id] = spawned
            spawn_tasks.append(
                self.broadcast({
                    "type": "agent_spawn",
                    "agent": spawned,
                    "timestamp": spawn_timestamp,
                })
            )

        if spawn_tasks:
            await asyncio.gather(*spawn_tasks)

    async def process_event(self, payload: Dict[str, Any]) -> None:
        event_type = payload.get("type")
        now_iso = datetime.now(timezone.utc).isoformat()

        if event_type == "zeus_task":
            clean_prompt = str(payload.get("prompt") or "").strip() or "General full-stack task"
            # 1. Immediately broadcast Zeus's 'orchestrating' status on the WebSocket loop
            await self.broadcast_zeus_orchestrating(clean_prompt)
            # 2. Await LLM JSON response in the background without blocking incoming WebSocket events
            bg_task = asyncio.create_task(self._resolve_llm_and_dispatch_spawns(clean_prompt))
            self.background_tasks.add(bg_task)
            bg_task.add_done_callback(self.background_tasks.discard)
        elif event_type in ("agent_spawn", "agent_move"):
            agent_raw = payload.get("agent", {})
            agent_id = str(agent_raw.get("id") or "agent-zeus")
            existing = self.agents.get(agent_id, {})
            cx, cy = clamp_to_circular_arena(
                float(agent_raw.get("x", existing.get("x", 0))),
                float(agent_raw.get("y", existing.get("y", 0)))
            )
            updated = {**existing, **agent_raw, "id": agent_id, "x": cx, "y": cy}
            self.agents[agent_id] = updated
            await self.broadcast({"type": event_type, "agent": updated, "timestamp": now_iso})
        elif event_type == "arena_reset":
            self.agents.clear()
            await self.broadcast({"type": "arena_reset", "agents": [], "timestamp": now_iso})


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            raw_message = await websocket.receive_text()
            await manager.process_event(json.loads(raw_message))
    except WebSocketDisconnect:
        manager.disconnect(websocket)


def main() -> None:
    multiprocessing.freeze_support()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info", ws="websockets")


if __name__ == "__main__":
    main()`
  },
  {
    id: 'dotenv-example',
    filename: '.env',
    filepath: 'backend/.env',
    language: 'bash',
    description: 'Environment file loaded by python-dotenv (load_dotenv()) in backend/main.py.',
    code: `# Place this file at:
# 1. backend/.env (during local Python development)
# 2. project-tartarus/.env (project root)
# 3. src-tauri/binaries/.env (next to the PyInstaller onefile executable)

GEMINI_API_KEY="AIzaSyYourActualGeminiApiKeyHere"
`
  },
  {
    id: 'app-jsx',
    filename: 'App.jsx',
    filepath: 'src/App.jsx',
    language: 'jsx',
    description: 'React + Phaser.js client starting with an empty arena, Initialize Zeus button, and Prompt Zeus input emitting zeus_task WebSocket events.',
    code: `import React, { useEffect, useRef, useState, useCallback } from 'react';
import Phaser from 'phaser';

const WS_URL = 'ws://127.0.0.1:8000/ws';
const ARENA_RADIUS = 250;
const MAX_AGENT_RADIUS = ARENA_RADIUS - 26;

class TartarusArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TartarusArenaScene' });
    this.agentSprites = new Map();
    this.agentData = new Map();
    this.agentProgress = new Map();
    this.lastDragPoint = new Map();
    this.isReady = false;
  }

  init(data) {
    this.onReady = data?.onReady;
    this.onAgentDragEnd = data?.onAgentDragEnd;
  }

  create() {
    this.center = { x: this.scale.width / 2, y: this.scale.height / 2 };
    this.arenaGraphics = this.add.graphics();
    this.drawCircularArena(this.center.x, this.center.y, ARENA_RADIUS);
    this.isReady = true;

    this.input.on('dragstart', (_pointer, gameObject) => {
      const agentId = gameObject.getData('agentId');
      if (agentId) {
        this.lastDragPoint.set(agentId, { x: gameObject.x, y: gameObject.y });
        this.agentProgress.set(agentId, {
          active: true,
          progress: 0.05,
          duration: 2200,
          hex: 0x38bdf8,
        });
      }
    });

    this.input.on('drag', (_pointer, gameObject, dragX, dragY) => {
      gameObject.setPosition(dragX, dragY);
      const agentId = gameObject.getData('agentId');
      const existing = this.agentData.get(agentId);
      const lastPt = this.lastDragPoint.get(agentId);
      if (lastPt && Math.hypot(dragX - lastPt.x, dragY - lastPt.y) >= 10) {
        const colorHex = Phaser.Display.Color.HexStringToColor(
          existing?.color || '#FEF08A'
        ).color;
        this.drawPersistentMotionPath(lastPt.x, lastPt.y, dragX, dragY, colorHex);
        this.lastDragPoint.set(agentId, { x: dragX, y: dragY });
      }
    });

    this.input.on('dragend', (_pointer, gameObject) => {
      const agentId = gameObject.getData('agentId');
      const existing = this.agentData.get(agentId);
      if (!existing) return;

      const relX = gameObject.x - this.center.x;
      const relY = gameObject.y - this.center.y;
      const dist = Math.hypot(relX, relY);
      const scale = dist > MAX_AGENT_RADIUS && dist > 0 ? MAX_AGENT_RADIUS / dist : 1;
      const clampedX = Math.round(relX * scale);
      const clampedY = Math.round(relY * scale);

      const finalX = this.center.x + clampedX;
      const finalY = this.center.y + clampedY;
      const lastPt = this.lastDragPoint.get(agentId);
      if (lastPt) {
        const colorHex = Phaser.Display.Color.HexStringToColor(
          existing.color || '#FEF08A'
        ).color;
        this.drawPersistentMotionPath(lastPt.x, lastPt.y, finalX, finalY, colorHex);
        this.lastDragPoint.delete(agentId);
      }

      gameObject.setPosition(finalX, finalY);
      const updated = { ...existing, state: 'moving', x: clampedX, y: clampedY };
      this.agentData.set(agentId, updated);
      this.agentProgress.set(agentId, {
        active: true,
        progress: 0.05,
        duration: 2200,
        hex: 0x38bdf8,
      });

      if (this.onAgentDragEnd) {
        this.onAgentDragEnd(updated);
      }
    });

    if (this.onReady) this.onReady(this);

    this.scale.on('resize', (gameSize) => {
      this.center = { x: gameSize.width / 2, y: gameSize.height / 2 };
      this.drawCircularArena(this.center.x, this.center.y, ARENA_RADIUS);
    });
  }

  update(_time, delta) {
    if (!this.isReady) return;
    const dt = Math.min(Math.max(delta, 4), 100);

    this.agentProgress.forEach((prog, agentId) => {
      const container = this.agentSprites.get(agentId);
      if (!container) return;
      const arc = container.getByName('progressArc');
      if (!arc) return;

      arc.clear();
      if (!prog.active) return;

      prog.progress += dt / prog.duration;
      if (prog.progress > 1.12) {
        prog.progress = 0;
      }

      const clamped = Phaser.Math.Clamp(prog.progress, 0, 1);
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + clamped * Math.PI * 2;

      arc.lineStyle(4, 0x090d16, 0.9);
      arc.strokeCircle(0, -1, 16);
      arc.lineStyle(2, 0x1e293b, 0.95);
      arc.strokeCircle(0, -1, 16);
      arc.lineStyle(2.5, clamped >= 0.99 ? 0x10b981 : prog.hex, 0.98);
      arc.beginPath();
      arc.arc(0, -1, 16, startAngle, endAngle, false);
      arc.strokePath();
    });
  }

  drawPersistentMotionPath(fromX, fromY, toX, toY, colorHex) {
    const dist = Math.hypot(toX - fromX, toY - fromY);
    if (dist < 3) return;
    const maxLen = 28;
    const scale = dist > maxLen ? maxLen / dist : 1;
    const tailX = toX - (toX - fromX) * scale;
    const tailY = toY - (toY - fromY) * scale;

    const trail = this.add.graphics();
    trail.setDepth(2);
    trail.lineStyle(2, colorHex, 0.65);
    trail.lineBetween(tailX, tailY + 8, toX, toY + 8);

    this.tweens.add({
      targets: trail,
      alpha: 0,
      delay: 0,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => trail.destroy(),
    });
  }

  drawCircularArena(cx, cy, radius) {
    const g = this.arenaGraphics;
    g.clear();
    g.fillStyle(0x090d16, 1);
    g.fillCircle(cx, cy + 16, radius + 10);
    g.lineStyle(3, 0x334155, 1);
    g.fillStyle(0x111827, 1);
    g.fillCircle(cx, cy, radius);
    g.strokeCircle(cx, cy, radius);
    g.lineStyle(2, 0xf59e0b, 0.35);
    g.strokeCircle(cx, cy, radius - 6);
  }

  handleServerEvent(payload) {
    if (!this.isReady) return;
    if (payload.type === 'init_arena' && Array.isArray(payload.agents)) {
      payload.agents.forEach((agent) => this.upsertAgent(agent));
    } else if (
      (payload.type === 'agent_spawn' ||
        payload.type === 'agent_move' ||
        payload.type === 'agent_state') &&
      payload.agent
    ) {
      this.upsertAgent(payload.agent);
    } else if (payload.type === 'arena_reset') {
      this.agentSprites.forEach((c) => c.destroy());
      this.agentSprites.clear();
      this.agentData.clear();
      this.agentProgress.clear();
    }
  }

  upsertAgent(agent) {
    this.agentData.set(agent.id, agent);
    const targetX = this.center.x + (agent.x || 0);
    const targetY = this.center.y + (agent.y || 0);
    const colorHex = Phaser.Display.Color.HexStringToColor(
      agent.color || '#FEF08A'
    ).color;

    const stateKey = (agent.state || 'idle').toLowerCase();
    const stateColors = {
      orchestrating: { hex: 0xfef08a, text: '#FEF08A', symbol: '⚡', dur: 620 },
      coding: { hex: 0x10b981, text: '#34D399', symbol: '</>', dur: 820 },
      moving: { hex: 0x38bdf8, text: '#38BDF8', symbol: '»', dur: 420 },
      reviewing: { hex: 0xa855f7, text: '#C084FC', symbol: '◈', dur: 960 },
      idle: { hex: 0x64748b, text: '#94A3B8', symbol: '⏸', dur: 1500 },
    };
    const stateSpec = stateColors[stateKey] || stateColors.idle;

    const showProgress = stateKey === 'moving' || stateKey === 'orchestrating';
    this.agentProgress.set(agent.id, {
      active: showProgress,
      progress: showProgress ? 0.04 : 0,
      duration: stateKey === 'moving' ? 2200 : 3400,
      hex: stateSpec.hex,
    });

    if (this.agentSprites.has(agent.id)) {
      const container = this.agentSprites.get(agent.id);
      const pulseRing = container.getByName('statePulseRing');
      if (pulseRing) {
        this.tweens.killTweensOf(pulseRing);
        pulseRing.setScale(1).setAlpha(0.9);
        pulseRing.setStrokeStyle(2, stateSpec.hex, 0.95);
        this.tweens.add({
          targets: pulseRing,
          scaleX: 1.4,
          scaleY: 1.4,
          alpha: 0.08,
          duration: stateSpec.dur,
          repeat: -1,
        });
      }
      const stateBadge = container.getByName('stateBadge');
      if (stateBadge) {
        stateBadge.setText(
          stateSpec.symbol + ' ' + stateKey.toUpperCase() + ' · (' + agent.x + ', ' + agent.y + ')'
        );
        stateBadge.setColor(stateSpec.text);
      }

      this.drawPersistentMotionPath(
        container.x,
        container.y,
        targetX,
        targetY,
        colorHex
      );
      this.tweens.add({
        targets: container,
        x: targetX,
        y: targetY,
        duration: 240,
        ease: 'Quad.easeOut',
      });
      return;
    }

    const shadow = this.add.ellipse(0, 10, 20, 8, 0x000000, 0.5);
    const statePulseRing = this.add
      .ellipse(0, 10, 26, 11, stateSpec.hex, 0.14)
      .setStrokeStyle(2, stateSpec.hex, 0.95)
      .setName('statePulseRing');
    this.tweens.add({
      targets: statePulseRing,
      scaleX: 1.4,
      scaleY: 1.4,
      alpha: 0.08,
      duration: stateSpec.dur,
      repeat: -1,
    });

    const progressArc = this.add.graphics().setName('progressArc');

    const body = this.add
      .rectangle(0, 0, 18, 18, colorHex)
      .setStrokeStyle(2, 0xffffff);
    const label = this.add
      .text(0, -24, agent.name || agent.id, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: agent.color || '#F8FAFC',
        backgroundColor: '#0F172A',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);
    const stateBadge = this.add
      .text(
        0,
        22,
        stateSpec.symbol + ' ' + stateKey.toUpperCase() + ' · (' + agent.x + ', ' + agent.y + ')',
        {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: stateSpec.text,
        }
      )
      .setOrigin(0.5)
      .setName('stateBadge');

    const container = this.add.container(targetX, targetY, [
      shadow,
      statePulseRing,
      progressArc,
      body,
      label,
      stateBadge,
    ]);
    container.setData('agentId', agent.id);
    container.setSize(36, 36);
    container.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-18, -18, 36, 36),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      draggable: true,
      useHandCursor: true,
    });
    this.input.setDraggable(container);
    this.agentSprites.set(agent.id, container);
  }
}

export default function App() {
  const gameContainerRef = useRef(null);
  const phaserGameRef = useRef(null);
  const pendingEventsRef = useRef([]);
  const wsRef = useRef(null);
  const [agents, setAgents] = useState([]);
  const [prompt, setPrompt] = useState('');

  const dispatchEvent = useCallback((payload, skipPhaser = false) => {
    if (!skipPhaser) {
      const scene = phaserGameRef.current?.scene?.getScene('TartarusArenaScene');
      if (scene && scene.isReady) {
        scene.handleServerEvent(payload);
      } else {
        pendingEventsRef.current.push(payload);
      }
    }

    if (payload.type === 'init_arena' && Array.isArray(payload.agents)) {
      setAgents(payload.agents);
    } else if (
      (payload.type === 'agent_spawn' ||
        payload.type === 'agent_move' ||
        payload.type === 'agent_state') &&
      payload.agent
    ) {
      setAgents((prev) => {
        const exists = prev.some((a) => a.id === payload.agent.id);
        return exists
          ? prev.map((a) => (a.id === payload.agent.id ? payload.agent : a))
          : [...prev, payload.agent];
      });
    }
  }, []);

  useEffect(() => {
    if (!gameContainerRef.current || phaserGameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: gameContainerRef.current,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#0B0F17',
      pixelArt: true,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [TartarusArenaScene],
    });

    game.events.once('ready', () => {
      const scene = game.scene.getScene('TartarusArenaScene');
      scene.scene.restart({
        onReady: (readyScene) => {
          while (pendingEventsRef.current.length > 0) {
            readyScene.handleServerEvent(pendingEventsRef.current.shift());
          }
        },
        onAgentDragEnd: (movedAgent) => {
          const msg = { type: 'agent_move', agent: movedAgent };
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
          }
          dispatchEvent(msg, true);
        },
      });
    });

    phaserGameRef.current = game;
    return () => {
      game.destroy(true);
      phaserGameRef.current = null;
    };
  }, [dispatchEvent]);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;
    socket.onmessage = (event) => {
      try {
        dispatchEvent(JSON.parse(event.data));
      } catch (err) {
        console.error('Invalid WS JSON:', err);
      }
    };
    return () => socket.close();
  }, [dispatchEvent]);

  const handleInitializeZeus = () => {
    const msg = {
      type: 'agent_spawn',
      agent: {
        id: 'agent-zeus',
        name: 'Zeus',
        role: 'Orchestrator Prime',
        state: 'orchestrating',
        x: 0,
        y: 0,
        color: '#FEF08A',
      },
    };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      dispatchEvent(msg);
    }
  };

  const handlePromptZeus = (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'zeus_task', prompt }));
    }
    setPrompt('');
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={gameContainerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: 16, left: 16, color: '#fff', fontFamily: 'monospace' }}>
        <button onClick={handleInitializeZeus}>Initialize Zeus</button>
        <form onSubmit={handlePromptZeus} style={{ marginTop: 8 }}>
          <label>
            Prompt Zeus:
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Build database and frontend"
            />
          </label>
          <button type="submit">Submit</button>
        </form>
        <ul>
          {agents.map((a) => (
            <li key={a.id} style={{ color: a.color }}>
              {a.name}: ({a.x}, {a.y})
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}`
  },
  {
    id: 'tauri-conf',
    filename: 'tauri.conf.json',
    filepath: 'src-tauri/tauri.conf.json',
    language: 'json',
    description: 'Tauri v2 configuration with bundle.externalBin configured for the PyInstaller tartarus-backend executable.',
    code: `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Project Tartarus",
  "version": "0.1.0",
  "identifier": "com.tartarus.workspace",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Project Tartarus — 2.5D AI Agent Workspace",
        "width": 1440,
        "height": 900,
        "minWidth": 1024,
        "minHeight": 680,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' ws://127.0.0.1:8000 http://127.0.0.1:8000; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"],
    "externalBin": [
      "binaries/tartarus-backend"
    ],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico"
    ]
  }
}`
  },
  {
    id: 'main-jsx',
    filename: 'main.jsx',
    filepath: 'src/main.jsx',
    language: 'jsx',
    description: 'React entry point mounting the root application container.',
    code: `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(<App />);`
  }
];
