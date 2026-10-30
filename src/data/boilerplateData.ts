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
    id: 'main-jsx',
    filename: 'main.jsx',
    filepath: 'src/main.jsx',
    language: 'jsx',
    description: 'React entry point that auto-spawns the compiled PyInstaller tartarus-backend sidecar when running inside Tauri v2.',
    code: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

async function spawnTartarusSidecar() {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { Command } = await import('@tauri-apps/plugin-shell');
      const sidecar = Command.sidecar('binaries/tartarus-backend');
      await sidecar.spawn();
    } catch (err) {
      console.error('Failed to spawn Tartarus Python sidecar:', err);
    }
  }
}

spawnTartarusSidecar();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`
  },
  {
    id: 'app-jsx',
    filename: 'App.jsx',
    filepath: 'src/App.jsx',
    language: 'jsx',
    description: 'Minimalist React workspace hosting the full-screen PhaserArena component and a single floating control panel for Initialize Zeus and Prompt Zeus.',
    code: `import React, { useEffect, useRef, useState, useCallback } from 'react';
import PhaserArena from './components/PhaserArena.jsx';

const WS_URL = 'ws://127.0.0.1:8000/ws';

export default function App() {
  const arenaRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const [prompt, setPrompt] = useState('');

  const routeEventToArena = useCallback((payload) => {
    arenaRef.current?.dispatchEventToScene(payload);
  }, []);

  const connectWebSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        routeEventToArena(data);
      } catch (err) {
        console.error('Invalid WebSocket JSON:', err);
      }
    };

    socket.onclose = () => {
      reconnectTimerRef.current = setTimeout(connectWebSocket, 3000);
    };
  }, [routeEventToArena]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const handleInitializeZeus = () => {
    const zeusSpawn = {
      type: 'agent_spawn',
      agent: {
        id: 'agent-zeus',
        name: 'Zeus',
        role: 'Orchestrator',
        state: 'orchestrating',
        x: 0,
        y: 0,
        color: '#FEF08A',
      },
    };

    routeEventToArena(zeusSpawn);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(zeusSpawn));
    }
  };

  const handlePromptSubmit = (e) => {
    e.preventDefault();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;

    // Instant 0ms visual feedback: set Zeus to 'orchestrating' immediately
    routeEventToArena({
      type: 'agent_state',
      agent: {
        id: 'agent-zeus',
        name: 'Zeus',
        role: 'Orchestrator',
        state: 'orchestrating',
        x: 0,
        y: 0,
        color: '#FEF08A',
      },
    });

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'zeus_task',
          prompt: cleanPrompt,
        })
      );
    }

    setPrompt('');
  };

  const handleAgentDragMove = useCallback((movedAgent) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'agent_move',
          agent: movedAgent,
        })
      );
    }
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0B0F17] text-slate-100">
      <PhaserArena ref={arenaRef} onAgentDragMove={handleAgentDragMove} />

      {/* Single Minimalist Floating Panel */}
      <aside
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-4 left-4 z-20 w-80 bg-[#111827]/95 backdrop-blur-md border border-[#1E293B] rounded-xl p-4 shadow-2xl space-y-3.5"
      >
        <button
          type="button"
          onClick={handleInitializeZeus}
          className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
        >
          Initialize Zeus
        </button>

        <form onSubmit={handlePromptSubmit} className="space-y-1.5">
          <label
            htmlFor="prompt-zeus-input"
            className="block text-xs font-medium text-slate-300"
          >
            Prompt Zeus
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="prompt-zeus-input"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Type a custom task..."
              autoComplete="off"
              className="w-full bg-[#0B0F17] border border-[#1E293B] focus:border-amber-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!prompt.trim()}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              Submit
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}`
  },
  {
    id: 'phaser-arena-jsx',
    filename: 'PhaserArena.jsx',
    filepath: 'src/components/PhaserArena.jsx',
    language: 'jsx',
    description: 'Phaser.js 2.5D circular obsidian arena inside a React useEffect hook with static spawning, role labels, pop-in animations, and strict mouse drag-and-drop.',
    code: `import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Phaser from 'phaser';

export const ARENA_RADIUS = 250;
export const MAX_AGENT_RADIUS = ARENA_RADIUS - 26;

const STATE_VISUAL_CONFIG = {
  orchestrating: { ringHex: 0xfef08a, textHex: '#FEF08A', symbol: '⚡', pulseScale: 1.48, pulseDuration: 620 },
  coding: { ringHex: 0x10b981, textHex: '#34D399', symbol: '</>', pulseScale: 1.34, pulseDuration: 820 },
  moving: { ringHex: 0x38bdf8, textHex: '#38BDF8', symbol: '»', pulseScale: 1.55, pulseDuration: 420 },
  reviewing: { ringHex: 0xa855f7, textHex: '#C084FC', symbol: '◈', pulseScale: 1.28, pulseDuration: 960 },
  idle: { ringHex: 0x64748b, textHex: '#94A3B8', symbol: '⏸', pulseScale: 1.1, pulseDuration: 1500 },
};

class TartarusArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TartarusArenaScene' });
    this.agentContainers = new Map();
    this.agentDataMap = new Map();
    this.draggingAgentIds = new Set();
    this.center = { x: 0, y: 0 };
    this.isCreated = false;
  }

  init(data) {
    this.onAgentDragEnd = data?.onAgentDragEnd;
    this.onReadyCallback = data?.onReadyCallback;
  }

  create() {
    this.center = {
      x: Math.round(this.scale.width / 2),
      y: Math.round(this.scale.height / 2),
    };

    this.arenaGraphics = this.add.graphics();
    this.dragConstraintRing = this.add.graphics();

    this.generatePantheonPixelTextures();
    this.renderCircularArena();
    this.registerDragAndDropListeners();
    this.isCreated = true;

    if (this.onReadyCallback) {
      this.onReadyCallback();
    }

    this.scale.on('resize', (gameSize) => {
      this.center = {
        x: Math.round(gameSize.width / 2),
        y: Math.round(gameSize.height / 2),
      };
      this.renderCircularArena();
      this.agentDataMap.forEach((agent, id) => {
        const container = this.agentContainers.get(id);
        if (container) {
          container.setPosition(this.center.x + agent.x, this.center.y + agent.y);
        }
      });
    });
  }

  clampCoordinatesToArena(relX, relY) {
    const dist = Math.hypot(relX, relY);
    if (dist > MAX_AGENT_RADIUS && dist > 0) {
      const scale = MAX_AGENT_RADIUS / dist;
      return { x: Math.round(relX * scale), y: Math.round(relY * scale) };
    }
    return { x: Math.round(relX), y: Math.round(relY) };
  }

  registerDragAndDropListeners() {
    this.input.on('dragstart', (_pointer, gameObject) => {
      const agentId = gameObject.getData('agentId');
      if (!agentId) return;

      this.draggingAgentIds.add(agentId);
      this.tweens.killTweensOf(gameObject);
      gameObject.setDepth(20).setAlpha(1).setScale(1.08);
      this.applyAgentStateVisuals(gameObject, 'moving');

      this.dragConstraintRing.clear();
      this.dragConstraintRing.lineStyle(1.5, 0xf59e0b, 0.55);
      this.dragConstraintRing.strokeCircle(this.center.x, this.center.y, MAX_AGENT_RADIUS);
    });

    this.input.on('drag', (_pointer, gameObject, dragX, dragY) => {
      gameObject.setPosition(dragX, dragY);
    });

    this.input.on('dragend', (_pointer, gameObject) => {
      const agentId = gameObject.getData('agentId');
      if (!agentId) return;

      this.draggingAgentIds.delete(agentId);
      this.dragConstraintRing.clear();
      gameObject.setDepth(5).setScale(1);

      const clamped = this.clampCoordinatesToArena(
        gameObject.x - this.center.x,
        gameObject.y - this.center.y
      );
      const finalX = this.center.x + clamped.x;
      const finalY = this.center.y + clamped.y;
      gameObject.setPosition(finalX, finalY);

      const existing = this.agentDataMap.get(agentId);
      if (existing) {
        const updatedAgent = {
          ...existing,
          state: 'moving',
          x: clamped.x,
          y: clamped.y,
        };
        this.agentDataMap.set(agentId, updatedAgent);
        this.applyAgentStateVisuals(gameObject, updatedAgent.state);

        if (this.onAgentDragEnd) {
          this.onAgentDragEnd(updatedAgent);
        }
      }
    });
  }

  generatePantheonPixelTextures() {
    const palettes = {
      zeus: { primary: 0xfef08a, trim: 0xffffff, eye: 0xffffff },
      hephaestus: { primary: 0xf59e0b, trim: 0xfcd34d, eye: 0xfef3c7 },
      helios: { primary: 0xeab308, trim: 0xfde047, eye: 0xfef9c3 },
      hades: { primary: 0xa855f7, trim: 0xd8b4fe, eye: 0xf3e8ff },
      poseidon: { primary: 0x38bdf8, trim: 0xbae6fd, eye: 0xe0f2fe },
      athena: { primary: 0x22d3ee, trim: 0xcffafe, eye: 0xecfeff },
    };

    Object.entries(palettes).forEach(([key, pal]) => {
      const texKey = 'pantheon-agent-' + key;
      if (this.textures.exists(texKey)) return;

      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x090d16, 1).fillRect(4, 2, 16, 18);
      g.fillStyle(pal.trim, 1).fillRect(7, 1, 10, 3);
      g.fillStyle(pal.primary, 1).fillRect(6, 4, 12, 13);
      g.fillStyle(0x090d16, 1).fillRect(7, 7, 10, 4);
      g.fillStyle(pal.eye, 1).fillRect(8, 8, 3, 2).fillRect(13, 8, 3, 2);
      g.fillStyle(pal.trim, 1).fillRect(2, 9, 3, 6).fillRect(19, 9, 3, 6);
      g.fillStyle(0x334155, 1).fillRect(6, 20, 4, 3).fillRect(14, 20, 4, 3);
      g.generateTexture(texKey, 24, 24);
      g.destroy();
    });
  }

  getTextureKeyForAgent(agent) {
    const key = ((agent.id || '') + ' ' + (agent.name || '')).toLowerCase();
    if (key.includes('zeus')) return 'pantheon-agent-zeus';
    if (key.includes('athena')) return 'pantheon-agent-athena';
    if (key.includes('hades')) return 'pantheon-agent-hades';
    if (key.includes('helios')) return 'pantheon-agent-helios';
    if (key.includes('poseidon')) return 'pantheon-agent-poseidon';
    return 'pantheon-agent-hephaestus';
  }

  getRoleLabelForAgent(agent) {
    if (agent.role && agent.role.trim()) return agent.role.trim();
    const key = ((agent.id || '') + ' ' + (agent.name || '')).toLowerCase();
    if (key.includes('zeus')) return 'Orchestrator';
    if (key.includes('athena')) return 'Conversational / Chat';
    if (key.includes('hephaestus')) return 'Database & Backend';
    if (key.includes('helios')) return 'Frontend';
    if (key.includes('hades')) return 'Systems & Security';
    if (key.includes('poseidon')) return 'API & Network';
    return 'Specialist';
  }

  renderCircularArena() {
    const { x: cx, y: cy } = this.center;
    const r = ARENA_RADIUS;
    const g = this.arenaGraphics;
    g.clear();

    g.fillStyle(0x05080f, 0.85).fillCircle(cx, cy + 26, r + 26);
    g.fillStyle(0x0d1322, 1).fillCircle(cx, cy + 18, r + 10);
    g.fillStyle(0x1e293b, 1).fillCircle(cx, cy, r + 10);
    g.lineStyle(3, 0x334155, 1).strokeCircle(cx, cy, r + 10);
    g.fillStyle(0x111827, 1).fillCircle(cx, cy, r);
    g.fillStyle(0x0f172a, 1).fillCircle(cx, cy, Math.round(r * 0.72));
    g.fillStyle(0x131c31, 1).fillCircle(cx, cy, Math.round(r * 0.38));
    g.lineStyle(2, 0xf59e0b, 0.35).strokeCircle(cx, cy, r - 6);
  }

  applyAgentStateVisuals(container, state) {
    const key = (state || 'idle').toLowerCase();
    const spec = STATE_VISUAL_CONFIG[key] || STATE_VISUAL_CONFIG.idle;

    const pulseRing = container.getByName('statePulseRing');
    if (pulseRing) {
      this.tweens.killTweensOf(pulseRing);
      pulseRing.setScale(1).setAlpha(0.9);
      pulseRing.setStrokeStyle(2, spec.ringHex, 0.95);
      pulseRing.setFillStyle(spec.ringHex, 0.14);
      this.tweens.add({
        targets: pulseRing,
        scaleX: spec.pulseScale,
        scaleY: spec.pulseScale,
        alpha: 0.08,
        duration: spec.pulseDuration,
        repeat: -1,
        ease: 'Sine.easeOut',
      });
    }

    const stateBadge = container.getByName('stateBadge');
    if (stateBadge) {
      stateBadge.setText(spec.symbol + ' ' + key.toUpperCase());
      stateBadge.setColor(spec.textHex);
    }
  }

  handleServerEvent(payload) {
    if (!this.isCreated) return;
    if (payload.type === 'init_arena' && Array.isArray(payload.agents)) {
      this.agentContainers.forEach((c) => c.destroy());
      this.agentContainers.clear();
      this.agentDataMap.clear();
      payload.agents.forEach((ag) => this.upsertAgent(ag, 'agent_spawn'));
    } else if (
      (payload.type === 'agent_spawn' ||
        payload.type === 'agent_move' ||
        payload.type === 'agent_state') &&
      payload.agent
    ) {
      this.upsertAgent(payload.agent, payload.type);
    } else if (payload.type === 'arena_reset') {
      this.agentContainers.forEach((c) => c.destroy());
      this.agentContainers.clear();
      this.agentDataMap.clear();
    }
  }

  upsertAgent(agent, eventType) {
    if (this.draggingAgentIds.has(agent.id) && eventType === 'agent_move') return;

    const clamped = this.clampCoordinatesToArena(agent.x || 0, agent.y || 0);
    const updatedAgent = {
      ...agent,
      role: this.getRoleLabelForAgent(agent),
      x: clamped.x,
      y: clamped.y,
    };
    this.agentDataMap.set(agent.id, updatedAgent);

    const screenX = this.center.x + clamped.x;
    const screenY = this.center.y + clamped.y;

    if (this.agentContainers.has(agent.id)) {
      const container = this.agentContainers.get(agent.id);
      container.setPosition(screenX, screenY);

      const roleTag = container.getByName('roleTag');
      if (roleTag) roleTag.setText(updatedAgent.role);

      const nameTag = container.getByName('nameTag');
      if (nameTag) nameTag.setText(updatedAgent.name);

      this.applyAgentStateVisuals(container, updatedAgent.state);
      return;
    }

    const spec =
      STATE_VISUAL_CONFIG[(updatedAgent.state || 'idle').toLowerCase()] ||
      STATE_VISUAL_CONFIG.idle;
    const shadow = this.add.ellipse(0, 12, 24, 9, 0x05080f, 0.8);
    const statePulseRing = this.add
      .ellipse(0, 10, 28, 12, spec.ringHex, 0.14)
      .setStrokeStyle(2, spec.ringHex, 0.95)
      .setName('statePulseRing');

    const sprite = this.add
      .image(0, 0, this.getTextureKeyForAgent(updatedAgent))
      .setScale(1.2);

    const roleTag = this.add
      .text(0, -44, updatedAgent.role, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#94A3B8',
        backgroundColor: '#090D16E6',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5)
      .setName('roleTag');

    const nameTag = this.add
      .text(0, -27, updatedAgent.name, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: updatedAgent.color || '#F8FAFC',
        backgroundColor: '#0B0F17E6',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)
      .setName('nameTag');

    const stateBadge = this.add
      .text(0, 24, spec.symbol + ' ' + (updatedAgent.state || 'idle').toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: spec.textHex,
        backgroundColor: '#0B0F17CC',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5)
      .setName('stateBadge');

    const container = this.add.container(screenX, screenY, [
      shadow,
      statePulseRing,
      sprite,
      roleTag,
      nameTag,
      stateBadge,
    ]);
    container.setDepth(5);
    container.setData('agentId', updatedAgent.id);
    container.setSize(40, 44);
    container.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-20, -22, 40, 44),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      draggable: true,
      useHandCursor: true,
    });
    this.input.setDraggable(container);

    this.agentContainers.set(agent.id, container);
    this.applyAgentStateVisuals(container, updatedAgent.state);

    // Subtle pop-in scale & fade-in animation on spawn
    container.setScale(0.35).setAlpha(0);
    this.tweens.add({
      targets: container,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 240,
      ease: 'Back.easeOut',
    });
  }
}

const PhaserArena = forwardRef(({ onAgentDragMove }, ref) => {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const pendingEventsRef = useRef([]);
  const dragCallbackRef = useRef(onAgentDragMove);

  useEffect(() => {
    dragCallbackRef.current = onAgentDragMove;
  }, [onAgentDragMove]);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: containerRef.current.clientWidth || window.innerWidth,
      height: containerRef.current.clientHeight || window.innerHeight,
      backgroundColor: '#0B0F17',
      pixelArt: true,
      antialias: false,
      roundPixels: true,
      input: { keyboard: false },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [TartarusArenaScene],
    });

    game.events.once('ready', () => {
      const scene = game.scene.getScene('TartarusArenaScene');
      if (scene) {
        scene.scene.restart({
          onAgentDragEnd: (agent) => dragCallbackRef.current?.(agent),
          onReadyCallback: () => {
            while (pendingEventsRef.current.length > 0) {
              scene.handleServerEvent(pendingEventsRef.current.shift());
            }
          },
        });
      }
    });

    gameRef.current = game;
    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    dispatchEventToScene: (event) => {
      const scene = gameRef.current?.scene?.getScene('TartarusArenaScene');
      if (scene && scene.isCreated) {
        scene.handleServerEvent(event);
      } else {
        pendingEventsRef.current.push(event);
      }
    },
  }));

  return <div ref={containerRef} className="w-full h-full bg-[#0B0F17] overflow-hidden select-none" />;
});

export default PhaserArena;`
  },
  {
    id: 'main-py',
    filename: 'main.py',
    filepath: 'backend/main.py',
    language: 'python',
    description: 'FastAPI WebSocket server integrating async gemini-1.5-flash (generate_content_async) and PyInstaller --onefile support.',
    code: `import os
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
    "(not related to databases, frontends, or networking), you must output [\\"athena\\"] in your strict JSON array."
)

GENERATION_CONFIG = {"response_mime_type": "application/json"}

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

ZEUS_MODEL = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
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
        generation_config=GENERATION_CONFIG,
    )
    return response.text


async def analyze_task_with_gemini_async(task_prompt: str) -> List[str]:
    api_key = os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in .env")

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
        self.background_tasks: Set[asyncio.Task[Any]] = set()

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
            clean_prompt = str(payload.get("prompt") or "").strip() or "General task"
            await self.broadcast_zeus_orchestrating(clean_prompt)
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
  }
];
