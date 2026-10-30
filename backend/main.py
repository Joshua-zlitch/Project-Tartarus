"""
Project Tartarus — Complete FastAPI + WebSockets Backend (backend/main.py)
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
    response = ZEUS_MODEL.generate_content(
        task_prompt,
        generation_config=GENERATION_CONFIG,
    )
    return response.text


async def analyze_task_with_gemini_async(task_prompt: str) -> List[str]:
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


app = FastAPI(
    title="Project Tartarus — Zeus Gemini Orchestrator WebSocket Server",
    version="1.3.0",
)

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
        self.background_tasks: Set[asyncio.Task[Any]] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        await websocket.send_text(
            json.dumps(
                {
                    "type": "init_arena",
                    "agents": list(self.agents.values()),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
        )

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

    async def process_event(self, payload: Dict[str, Any]) -> None:
        event_type = payload.get("type")
        now_iso = datetime.now(timezone.utc).isoformat()

        if event_type == "zeus_task":
            prompt_str = str(payload.get("prompt") or payload.get("task") or "")
            clean_prompt = prompt_str.strip() or "General full-stack architecture task"

            await self.broadcast_zeus_orchestrating(clean_prompt)

            bg_task = asyncio.create_task(
                self._resolve_llm_and_dispatch_spawns(clean_prompt)
            )
            self.background_tasks.add(bg_task)
            bg_task.add_done_callback(self.background_tasks.discard)
        elif event_type in ("agent_spawn", "agent_move"):
            agent_raw = payload.get("agent", {})
            agent_id = str(agent_raw.get("id") or "agent-zeus")
            existing = self.agents.get(agent_id, {})
            cx, cy = clamp_to_circular_arena(
                float(agent_raw.get("x", existing.get("x", 0))),
                float(agent_raw.get("y", existing.get("y", 0))),
            )
            updated = {
                **existing,
                **agent_raw,
                "id": agent_id,
                "x": cx,
                "y": cy,
            }
            self.agents[agent_id] = updated
            await self.broadcast(
                {"type": event_type, "agent": updated, "timestamp": now_iso}
            )
        elif event_type == "arena_reset":
            self.agents.clear()
            await self.broadcast(
                {"type": "arena_reset", "agents": [], "timestamp": now_iso}
            )


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
