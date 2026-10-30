"""
Project Tartarus — Complete FastAPI + WebSockets Backend (main.py)
Refactored for strict non-blocking asynchronous LLM execution in the FastAPI event loop:
1. Securely loads GEMINI_API_KEY from .env using python-dotenv.
2. Pre-initializes `gemini-1.5-flash` with `generation_config={"response_mime_type": "application/json"}`.
3. When `zeus_task` arrives on `/ws`:
   - Immediately broadcasts Zeus's `'orchestrating'` state to the React frontend.
   - Schedules the Gemini LLM call as a non-blocking background `asyncio.Task` (`asyncio.create_task`)
     so the WebSocket `receive_text()` loop never blocks other incoming events (such as `agent_move`).
   - Uses `await ZEUS_MODEL.generate_content_async(...)` (with `await asyncio.to_thread(...)` fallback)
     and dispatches `agent_spawn` events concurrently via `asyncio.gather` the exact millisecond
     the JSON array resolves.
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
from typing import Dict, List, Any, Optional, Set

from dotenv import load_dotenv
import google.generativeai as genai
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn


# ---------------------------------------------------------------------------
# 1. Securely Load GEMINI_API_KEY via python-dotenv & Pre-Initialize Model
# ---------------------------------------------------------------------------
def load_environment() -> Optional[str]:
    """
    Loads GEMINI_API_KEY from .env files in priority order:
    1. Next to the compiled PyInstaller executable (when frozen as --onefile .exe)
    2. Current working directory / backend directory (`backend/.env`)
    3. Project root directory (`../.env`)
    """
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
    "(not related to databases, frontends, or networking), you must output [\"athena\"] in your strict JSON array."
)

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
GENERATION_CONFIG = {"response_mime_type": "application/json"}

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

ZEUS_MODEL = genai.GenerativeModel(
    model_name=GEMINI_MODEL_NAME,
    system_instruction=ZEUS_SYSTEM_INSTRUCTION,
    generation_config=GENERATION_CONFIG,
)


# ---------------------------------------------------------------------------
# 2. Arena Geometry & Pantheon Agent Templates
# ---------------------------------------------------------------------------
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
    """Clamps (x, y) coordinates so agents remain strictly inside the 2D circular arena."""
    dist = math.hypot(x, y)
    if dist > MAX_AGENT_RADIUS and dist > 0:
        scale = MAX_AGENT_RADIUS / dist
        return round(x * scale), round(y * scale)
    return round(x), round(y)


def random_arena_coordinates(min_r: int = 55, max_r: int = 210) -> tuple[int, int]:
    """Generates random polar coordinates within the circular arena radius."""
    angle = random.uniform(0, 2 * math.pi)
    radius = random.uniform(min_r, min(max_r, MAX_AGENT_RADIUS))
    return round(math.cos(angle) * radius), round(math.sin(angle) * radius)


def parse_llm_json_agent_array(raw_text: str) -> List[str]:
    """
    Parses the Gemini LLM response into a validated list of Pantheon role keys:
    ['hephaestus', 'helios', 'hades', 'poseidon', 'athena'].
    """
    cleaned = raw_text.strip()
    if not cleaned.startswith("["):
        bracket_match = re.search(r"\[.*\]", cleaned, flags=re.DOTALL)
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
    """Synchronous helper executed inside a worker thread via asyncio.to_thread if needed."""
    response = ZEUS_MODEL.generate_content(
        task_prompt,
        generation_config=GENERATION_CONFIG,
    )
    return response.text


async def analyze_task_with_gemini_async(task_prompt: str) -> List[str]:
    """
    Strictly non-blocking Gemini LLM call:
    Uses `await ZEUS_MODEL.generate_content_async(...)` and falls back to
    `await asyncio.to_thread(_sync_generate_json, ...)` so the FastAPI event loop
    is never blocked.
    """
    api_key = os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Create a .env file with GEMINI_API_KEY=your_key."
        )

    try:
        response = await ZEUS_MODEL.generate_content_async(
            task_prompt,
            generation_config=GENERATION_CONFIG,
        )
        raw_text = response.text
    except Exception:
        raw_text = await asyncio.to_thread(_sync_generate_json, task_prompt)

    selected_agents = parse_llm_json_agent_array(raw_text)
    return selected_agents or ["athena"]


# ---------------------------------------------------------------------------
# 3. FastAPI App & Non-Blocking WebSocket ConnectionManager
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Project Tartarus — Zeus Gemini Orchestrator WebSocket Server",
    version="1.3.0",
    description="Non-blocking async WebSocket server powered by Gemini JSON orchestration.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "tauri://localhost",
        "https://tauri.localhost",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    """
    Manages active WebSocket connections and executes `zeus_task` LLM calls
    as background `asyncio.Task` coroutines so the WebSocket loop never hangs.
    """

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self.agents: Dict[str, Dict[str, Any]] = {}
        # Hold strong references to background LLM tasks so GC never collects them mid-flight
        self.background_tasks: Set[asyncio.Task[Any]] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        init_payload = {
            "type": "init_arena",
            "agents": list(self.agents.values()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await websocket.send_text(json.dumps(init_payload))

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        """Broadcasts a JSON event payload concurrently to all connected WebSocket clients."""
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
        """
        Immediately broadcasts Zeus's 'orchestrating' status on the WebSocket loop
        before the background Gemini LLM task begins awaiting the model response.
        """
        zeus_template = PANTHEON_TEMPLATES["zeus"]
        zeus_existing = self.agents.get("agent-zeus")
        zeus_agent = {
            "id": "agent-zeus",
            "name": zeus_template["name"],
            "role": zeus_template["role"],
            "state": "orchestrating",
            "x": zeus_existing["x"] if zeus_existing else 0,
            "y": zeus_existing["y"] if zeus_existing else 0,
            "color": zeus_template["color"],
            "task": f"Orchestrating: {clean_prompt}",
        }
        self.agents["agent-zeus"] = zeus_agent
        await self.broadcast(
            {
                "type": "agent_spawn" if not zeus_existing else "agent_state",
                "agent": zeus_agent,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def _resolve_llm_and_dispatch_spawns(self, clean_prompt: str) -> None:
        """
        Runs in the background without blocking incoming WebSocket events:
        1. Awaits the async Gemini JSON response (`generate_content_async` / `asyncio.to_thread`).
        2. Dispatches all `agent_spawn` events concurrently the exact millisecond the JSON resolves.
        """
        try:
            selected_role_keys = await analyze_task_with_gemini_async(clean_prompt)
        except Exception as exc:
            print(f"[Zeus Gemini Orchestrator Warning] {exc}")
            lower_prompt = clean_prompt.lower()
            selected_role_keys = []
            if any(k in lower_prompt for k in ("database", "db", "sql", "backend", "schema")):
                selected_role_keys.append("hephaestus")
            if any(k in lower_prompt for k in ("frontend", "ui", "react", "phaser", "css")):
                selected_role_keys.append("helios")
            if any(k in lower_prompt for k in ("security", "auth", "system", "memory", "kernel")):
                selected_role_keys.append("hades")
            if any(k in lower_prompt for k in ("api", "network", "websocket", "socket", "stream")):
                selected_role_keys.append("poseidon")
            if not selected_role_keys:
                selected_role_keys = ["athena"]

        spawn_timestamp = datetime.now(timezone.utc).isoformat()
        spawn_broadcasts = []

        for role_key in selected_role_keys:
            spec = PANTHEON_TEMPLATES.get(role_key)
            if not spec:
                continue

            agent_id = spec["id"]
            rand_x, rand_y = random_arena_coordinates()
            spawned_specialist = {
                "id": agent_id,
                "name": spec["name"],
                "role": spec["role"],
                "state": spec["state"],
                "x": rand_x,
                "y": rand_y,
                "color": spec["color"],
                "task": f"Dispatched by Zeus: {clean_prompt}",
            }
            self.agents[agent_id] = spawned_specialist

            spawn_broadcasts.append(
                self.broadcast(
                    {
                        "type": "agent_spawn",
                        "agent": spawned_specialist,
                        "timestamp": spawn_timestamp,
                    }
                )
            )

        if spawn_broadcasts:
            await asyncio.gather(*spawn_broadcasts)

    async def process_event(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        event_type = payload.get("type")
        now_iso = datetime.now(timezone.utc).isoformat()

        if event_type == "zeus_task":
            prompt_str = str(payload.get("prompt") or payload.get("task") or "")
            clean_prompt = prompt_str.strip() or "General full-stack architecture task"

            # 1. Immediately broadcast Zeus's 'orchestrating' status to the React frontend
            await self.broadcast_zeus_orchestrating(clean_prompt)

            # 2. Await the LLM's JSON response in a background task without blocking other WebSocket events
            bg_task = asyncio.create_task(
                self._resolve_llm_and_dispatch_spawns(clean_prompt)
            )
            self.background_tasks.add(bg_task)
            bg_task.add_done_callback(self.background_tasks.discard)
            return None

        elif event_type == "agent_spawn":
            agent_raw = payload.get("agent", {})
            agent_id = str(agent_raw.get("id") or "agent-zeus")
            raw_x = float(agent_raw.get("x", 0))
            raw_y = float(agent_raw.get("y", 0))
            clamped_x, clamped_y = clamp_to_circular_arena(raw_x, raw_y)

            spawned_agent: Dict[str, Any] = {
                "id": agent_id,
                "name": str(agent_raw.get("name") or agent_id),
                "role": str(agent_raw.get("role") or "Specialist"),
                "state": str(agent_raw.get("state") or "coding"),
                "x": clamped_x,
                "y": clamped_y,
                "color": str(agent_raw.get("color") or "#FEF08A"),
                "task": str(agent_raw.get("task") or "Initialized in circular arena"),
            }
            self.agents[agent_id] = spawned_agent

            event_out = {
                "type": "agent_spawn",
                "agent": spawned_agent,
                "timestamp": now_iso,
            }
            await self.broadcast(event_out)
            return event_out

        elif event_type == "agent_move":
            agent_raw = payload.get("agent", {})
            agent_id = str(agent_raw.get("id") or "agent-zeus")
            existing = self.agents.get(
                agent_id,
                {
                    "id": agent_id,
                    "name": str(agent_raw.get("name") or agent_id),
                    "role": str(agent_raw.get("role") or "Specialist"),
                    "state": "moving",
                    "color": str(agent_raw.get("color") or "#FEF08A"),
                    "task": str(agent_raw.get("task") or "Relocating in arena"),
                },
            )

            raw_x = float(agent_raw.get("x", existing.get("x", 0)))
            raw_y = float(agent_raw.get("y", existing.get("y", 0)))
            clamped_x, clamped_y = clamp_to_circular_arena(raw_x, raw_y)

            moved_agent: Dict[str, Any] = {
                **existing,
                **agent_raw,
                "id": agent_id,
                "state": str(agent_raw.get("state") or "moving"),
                "x": clamped_x,
                "y": clamped_y,
            }
            self.agents[agent_id] = moved_agent

            event_out = {
                "type": "agent_move",
                "agent": moved_agent,
                "timestamp": now_iso,
            }
            await self.broadcast(event_out)
            return event_out

        elif event_type == "agent_state":
            agent_raw = payload.get("agent", {})
            agent_id = str(agent_raw.get("id") or "")
            if agent_id and agent_id in self.agents:
                updated_agent = {
                    **self.agents[agent_id],
                    **agent_raw,
                }
                self.agents[agent_id] = updated_agent
                event_out = {
                    "type": "agent_state",
                    "agent": updated_agent,
                    "timestamp": now_iso,
                }
                await self.broadcast(event_out)
                return event_out

        elif event_type == "arena_reset":
            self.agents.clear()
            event_out = {
                "type": "arena_reset",
                "agents": [],
                "timestamp": now_iso,
            }
            await self.broadcast(event_out)
            return event_out

        return None


manager = ConnectionManager()


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "tartarus-backend",
        "ws_endpoint": "ws://127.0.0.1:8000/ws",
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY),
        "connected_clients": len(manager.active_connections),
        "active_agents": len(manager.agents),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            raw_message = await websocket.receive_text()
            try:
                data = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send_text(
                    json.dumps(
                        {"type": "error", "message": "Malformed JSON payload"}
                    )
                )
                continue

            await manager.process_event(data)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


def main() -> None:
    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
        ws="websockets",
    )


if __name__ == "__main__":
    main()
