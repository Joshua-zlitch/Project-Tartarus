import { ArenaAgent } from '../types/arena';

export interface PantheonTemplate {
  id: string;
  name: string;
  role: string;
  state: ArenaAgent['state'];
  color: string;
  secondaryColor: string;
  colorLabel: string;
  keywords: string[];
  defaultX: number;
  defaultY: number;
  task: string;
}

/**
 * Full Pantheon Roster with distinct hex colors & orchestration keyword triggers:
 * - Zeus: Yellow/White (#FEF08A / #FFFFFF) — Orchestrator (spawned first via Initialize Zeus)
 * - Hephaestus: Amber (#F59E0B) — Triggered by database, backend, sql, compile, rust, schema, etc.
 * - Helios: Gold (#EAB308) — Triggered by frontend, ui, react, phaser, canvas, css, pixel, etc.
 * - Hades: Purple (#A855F7) — Triggered by security, auth, memory, kernel, cache, vector, debug, etc.
 * - Poseidon: Blue (#38BDF8) — Triggered by websocket, api, stream, network, fastapi, router, etc.
 * - Athena: Cyan (#22D3EE) — Triggered by conversational, chat, greeting, general knowledge, or non-technical prompts.
 */
export const PANTHEON_ROSTER: PantheonTemplate[] = [
  {
    id: 'agent-zeus',
    name: 'Zeus',
    role: 'Orchestrator',
    state: 'orchestrating',
    color: '#FEF08A',
    secondaryColor: '#FFFFFF',
    colorLabel: 'Yellow/White',
    keywords: ['zeus', 'orchestrate', 'lead', 'plan'],
    defaultX: 0,
    defaultY: 0,
    task: 'Awaiting task prompt to dispatch Pantheon agents',
  },
  {
    id: 'agent-hephaestus',
    name: 'Hephaestus',
    role: 'Database & Backend',
    state: 'coding',
    color: '#F59E0B',
    secondaryColor: '#FCD34D',
    colorLabel: 'Amber',
    keywords: [
      'database',
      'db',
      'sql',
      'postgres',
      'sqlite',
      'schema',
      'migration',
      'backend',
      'compile',
      'pyinstaller',
      'tauri',
      'rust',
      'server',
      'hephaestus',
    ],
    defaultX: -118,
    defaultY: -38,
    task: 'Architecting database schema & backend services',
  },
  {
    id: 'agent-helios',
    name: 'Helios',
    role: 'Frontend',
    state: 'coding',
    color: '#EAB308',
    secondaryColor: '#FDE047',
    colorLabel: 'Gold',
    keywords: [
      'frontend',
      'ui',
      'ux',
      'react',
      'phaser',
      'canvas',
      'css',
      'tailwind',
      'design',
      'layout',
      'shader',
      'pixel',
      'sprite',
      'component',
      'helios',
    ],
    defaultX: 73,
    defaultY: 100,
    task: 'Building frontend UI components & Phaser canvas',
  },
  {
    id: 'agent-hades',
    name: 'Hades',
    role: 'Systems & Security',
    state: 'reviewing',
    color: '#A855F7',
    secondaryColor: '#D8B4FE',
    colorLabel: 'Purple',
    keywords: [
      'security',
      'auth',
      'login',
      'jwt',
      'oauth',
      'memory',
      'kernel',
      'cache',
      'redis',
      'vector',
      'storage',
      'debug',
      'test',
      'audit',
      'system',
      'hades',
    ],
    defaultX: 118,
    defaultY: -38,
    task: 'Auditing security boundaries & memory state',
  },
  {
    id: 'agent-poseidon',
    name: 'Poseidon',
    role: 'API & Network',
    state: 'moving',
    color: '#38BDF8',
    secondaryColor: '#BAE6FD',
    colorLabel: 'Blue',
    keywords: [
      'websocket',
      'ws',
      'socket',
      'api',
      'rest',
      'graphql',
      'stream',
      'network',
      'fastapi',
      'uvicorn',
      'router',
      'realtime',
      'sync',
      'poseidon',
    ],
    defaultX: -73,
    defaultY: 100,
    task: 'Routing real-time WebSocket & API streams',
  },
  {
    id: 'agent-athena',
    name: 'Athena',
    role: 'Conversational / Chat',
    state: 'reviewing',
    color: '#22D3EE',
    secondaryColor: '#CFFAFE',
    colorLabel: 'Cyan',
    keywords: [
      'hello',
      'hi',
      'hey',
      'chat',
      'talk',
      'explain',
      'what is',
      'who is',
      'why',
      'how are you',
      'greeting',
      'general',
      'question',
      'story',
      'advice',
      'athena',
    ],
    defaultX: 0,
    defaultY: -120,
    task: 'Handling conversational & general knowledge queries',
  },
];

export function generateRandomArenaCoords(maxRadius = 210, minRadius = 55): {
  x: number;
  y: number;
} {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.floor(minRadius + Math.random() * (maxRadius - minRadius));
  return {
    x: Math.round(Math.cos(angle) * r),
    y: Math.round(Math.sin(angle) * r),
  };
}

/**
 * Mirrors the Python FastAPI `zeus_task` parser so local fallback
 * and live FastAPI WebSocket behave identically:
 * Technical tasks match Hephaestus/Helios/Hades/Poseidon; conversational or non-technical prompts route to Athena.
 */
export function parseZeusTaskPrompt(prompt: string): PantheonTemplate[] {
  const lower = prompt.toLowerCase();
  const technicalSpecialists = PANTHEON_ROSTER.filter(
    (p) => p.id !== 'agent-zeus' && p.id !== 'agent-athena'
  );
  const athena = PANTHEON_ROSTER.find((p) => p.id === 'agent-athena')!;

  const matchedTechnical = technicalSpecialists.filter((agent) =>
    agent.keywords.some((kw) => lower.includes(kw))
  );

  if (matchedTechnical.length > 0) {
    if (lower.includes('athena')) {
      return [...matchedTechnical, athena];
    }
    return matchedTechnical;
  }

  // Non-technical, conversational, greeting, or general knowledge prompts route to Athena
  return [athena];
}

/**
 * Maps the JSON array returned by the Gemini Zeus orchestrator
 * (e.g. ["athena"] or ["hephaestus", "helios"]) to PantheonTemplate definitions.
 */
export function resolveAgentsFromRoleNames(
  roleNames: string[]
): PantheonTemplate[] {
  const normalizedSet = new Set(
    roleNames.map((r) =>
      String(r)
        .trim()
        .toLowerCase()
        .replace(/^agent-/, '')
    )
  );

  const matched = PANTHEON_ROSTER.filter((spec) => {
    if (spec.id === 'agent-zeus') return false;
    const shortKey = spec.id.replace(/^agent-/, '').toLowerCase();
    return normalizedSet.has(shortKey);
  });

  return matched;
}
