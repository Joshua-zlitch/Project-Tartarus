/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PhaserArena, PhaserArenaHandle } from './components/PhaserArena';
import { EventInjectorDock } from './components/EventInjectorDock';
import { BoilerplateDrawer } from './components/BoilerplateDrawer';
import { ArenaAgent, ArenaWebSocketEvent } from './types/arena';
import {
  PANTHEON_ROSTER,
  generateRandomArenaCoords,
  parseZeusTaskPrompt,
  resolveAgentsFromRoleNames,
} from './data/pantheonRoster';

const DEFAULT_FASTAPI_WS_URL = 'ws://127.0.0.1:8000/ws';

export default function App() {
  const arenaRef = useRef<PhaserArenaHandle | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  // Arena starts completely empty; agents are static unless manually dragged with the mouse
  const [agents, setAgents] = useState<ArenaAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerSection, setDrawerSection] = useState<
    'commands' | 'code' | 'architecture'
  >('commands');

  // Route incoming server or drag events into React state and Phaser scene
  const routeServerEventToPhaser = useCallback(
    (payload: ArenaWebSocketEvent, skipPhaserDispatch = false) => {
      const enriched: ArenaWebSocketEvent = {
        ...payload,
        id:
          payload.id ||
          `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: payload.timestamp || new Date().toISOString(),
      };

      // 1. Route into Phaser.js scene unless originated from Phaser dragend
      if (!skipPhaserDispatch && enriched.type !== 'zeus_task') {
        arenaRef.current?.dispatchEventToScene(enriched);
      }

      // 2. Synchronize React dynamic agent list
      if (enriched.type === 'init_arena' && Array.isArray(enriched.agents)) {
        setAgents(enriched.agents);
        if (enriched.agents.length > 0) {
          setSelectedAgentId(enriched.agents[0].id);
        } else {
          setSelectedAgentId(null);
        }
      } else if (
        (enriched.type === 'agent_spawn' ||
          enriched.type === 'agent_move' ||
          enriched.type === 'agent_state') &&
        enriched.agent
      ) {
        const incomingAgent = enriched.agent;
        setAgents((prev) => {
          const exists = prev.some((a) => a.id === incomingAgent.id);
          if (exists) {
            return prev.map((a) =>
              a.id === incomingAgent.id ? { ...a, ...incomingAgent } : a
            );
          }
          return [...prev, incomingAgent];
        });
        setSelectedAgentId((prev) => prev || incomingAgent.id);
      } else if (enriched.type === 'arena_reset') {
        setAgents([]);
        setSelectedAgentId(null);
      }
    },
    []
  );

  // Establish live WebSocket connection to ws://127.0.0.1:8000/ws on mount
  const connectToFastApiWebSocket = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const socket = new WebSocket(DEFAULT_FASTAPI_WS_URL);
      wsRef.current = socket;

      socket.onmessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          routeServerEventToPhaser({
            ...parsed,
            source: 'websocket',
          });
        } catch (err) {
          console.error('Malformed WebSocket JSON frame:', err);
        }
      };

      socket.onclose = () => {
        reconnectTimerRef.current = window.setTimeout(() => {
          connectToFastApiWebSocket();
        }, 5000);
      };
    } catch {
      // Fallback to local orchestrator when local FastAPI server is not running
    }
  }, [routeServerEventToPhaser]);

  useEffect(() => {
    connectToFastApiWebSocket();
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connectToFastApiWebSocket]);

  const handleSendOrInjectEvent = useCallback(
    (event: ArenaWebSocketEvent, skipPhaserDispatch = false) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: event.type,
            prompt: event.prompt,
            agent: event.agent,
            agents: event.agents,
          })
        );
        if (skipPhaserDispatch) {
          routeServerEventToPhaser(event, true);
        }
      } else {
        routeServerEventToPhaser(event, skipPhaserDispatch);
      }
    },
    [routeServerEventToPhaser]
  );

  // 1. Initialize Zeus button handler: spawns only Zeus initially at the center
  const handleInitializeZeus = useCallback(() => {
    const zeusTemplate = PANTHEON_ROSTER[0];
    const existingZeus = agents.find((a) => a.id === 'agent-zeus');

    handleSendOrInjectEvent({
      type: 'agent_spawn',
      agent: {
        id: zeusTemplate.id,
        name: zeusTemplate.name,
        role: zeusTemplate.role,
        state: 'orchestrating',
        x: existingZeus ? existingZeus.x : 0,
        y: existingZeus ? existingZeus.y : 0,
        color: zeusTemplate.color,
        task: zeusTemplate.task,
      },
      timestamp: new Date().toISOString(),
      source: 'injector',
    });
  }, [agents, handleSendOrInjectEvent]);

  // 2. Submit Task to Zeus ('zeus_task' WebSocket event)
  const handleSubmitZeusTask = useCallback(
    async (prompt: string) => {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt) return;

      const zeusTemplate = PANTHEON_ROSTER[0];
      const existingZeus = agents.find((a) => a.id === 'agent-zeus');

      // Instant Visual Feedback (0ms): Immediately set Zeus to active 'orchestrating' state in Phaser
      // the exact millisecond the user clicks 'Submit', before any network/WebSocket round-trip.
      routeServerEventToPhaser({
        type: existingZeus ? 'agent_state' : 'agent_spawn',
        agent: {
          id: zeusTemplate.id,
          name: zeusTemplate.name,
          role: zeusTemplate.role,
          state: 'orchestrating',
          x: existingZeus ? existingZeus.x : 0,
          y: existingZeus ? existingZeus.y : 0,
          color: zeusTemplate.color,
          task: `Orchestrating: ${cleanPrompt}`,
        },
        timestamp: new Date().toISOString(),
        source: 'injector',
      });

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'zeus_task',
            prompt: cleanPrompt,
          })
        );
        return;
      }

      let matchedSpecialists = parseZeusTaskPrompt(cleanPrompt);
      try {
        const res = await fetch('/api/zeus-orchestrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: cleanPrompt }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.agents) && data.agents.length > 0) {
            const resolved = resolveAgentsFromRoleNames(data.agents);
            if (resolved.length > 0) {
              matchedSpecialists = resolved;
            }
          }
        }
      } catch {
        // Fallback to local specialist matching if offline
      }

      routeServerEventToPhaser(
        {
          type: 'zeus_task',
          prompt: cleanPrompt,
          spawnedAgents: matchedSpecialists.map((s) => s.id),
          timestamp: new Date().toISOString(),
          source: 'injector',
        },
        true
      );

      // Concurrent Spawning: Dispatch all selected specialist agent_spawn events immediately without blocking
      const nowIso = new Date().toISOString();
      matchedSpecialists.forEach((spec) => {
        const spawnCoords = generateRandomArenaCoords();

        routeServerEventToPhaser({
          type: 'agent_spawn',
          agent: {
            id: spec.id,
            name: spec.name,
            role: spec.role,
            state: spec.state || 'coding',
            x: spawnCoords.x,
            y: spawnCoords.y,
            color: spec.color,
            task: `Dispatched by Zeus: ${cleanPrompt}`,
          },
          timestamp: nowIso,
          source: 'injector',
        });
      });
    },
    [agents, routeServerEventToPhaser]
  );

  // Fired on Phaser dragend: constrains position within circular arena and fires agent_move back to React/WebSockets
  const handleAgentDragMove = useCallback(
    (draggedAgent: ArenaAgent) => {
      setSelectedAgentId(draggedAgent.id);
      handleSendOrInjectEvent(
        {
          type: 'agent_move',
          agent: draggedAgent,
          timestamp: new Date().toISOString(),
          source: 'arena_click',
        },
        true
      );
    },
    [handleSendOrInjectEvent]
  );

  const openDrawerWithSection = (
    section: 'commands' | 'code' | 'architecture'
  ) => {
    setDrawerSection(section);
    setDrawerOpen(true);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="relative z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0B0F17]/95 border-b border-[#1E293B]">
        {/* Brand Wordmark */}
        <a
          href="#arena"
          onClick={(e) => {
            e.preventDefault();
            setDrawerOpen(false);
          }}
          className="text-lg font-bold tracking-tight text-slate-100 font-display whitespace-nowrap shrink-0"
        >
          Project Tartarus
        </a>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setDrawerOpen(false)}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              !drawerOpen
                ? 'text-slate-100 underline underline-offset-8 decoration-amber-500'
                : ''
            }`}
          >
            Arena Canvas
          </button>
          <button
            onClick={() => openDrawerWithSection('commands')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              drawerOpen && drawerSection === 'commands'
                ? 'text-slate-100 underline underline-offset-8 decoration-amber-500'
                : ''
            }`}
          >
            Terminal Setup
          </button>
          <button
            onClick={() => openDrawerWithSection('code')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              drawerOpen && drawerSection === 'code'
                ? 'text-slate-100 underline underline-offset-8 decoration-amber-500'
                : ''
            }`}
          >
            Source Files
          </button>
          <button
            onClick={() => openDrawerWithSection('architecture')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              drawerOpen && drawerSection === 'architecture'
                ? 'text-slate-100 underline underline-offset-8 decoration-amber-500'
                : ''
            }`}
          >
            PyInstaller Spec
          </button>
        </nav>

        {/* Primary Action Button */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => {
              if (drawerOpen) {
                setDrawerOpen(false);
              } else {
                openDrawerWithSection('code');
              }
            }}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {drawerOpen ? 'Return to Arena' : 'Open Boilerplate & Commands'}
          </button>
        </div>
      </header>

      {/* Main Full-Screen Phaser 2.5D Circular Arena Viewport */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        <PhaserArena
          ref={arenaRef}
          onAgentDragMove={handleAgentDragMove}
          onSelectAgent={(id) => setSelectedAgentId(id)}
          selectedAgentId={selectedAgentId}
        />

        {/* Single Minimal Floating Window: Initialize Zeus & Prompt Zeus */}
        <div className="absolute top-4 left-4 z-20">
          <EventInjectorDock
            onInitializeZeus={handleInitializeZeus}
            onSubmitZeusTask={handleSubmitZeusTask}
          />
        </div>
      </main>

      {/* Slide-Over Boilerplate Code & Terminal Command Drawer */}
      <BoilerplateDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeSection={drawerSection}
        onSectionChange={setDrawerSection}
      />
    </div>
  );
}
