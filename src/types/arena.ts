export type AgentState = 'idle' | 'coding' | 'reviewing' | 'moving' | 'orchestrating';

export interface ArenaAgent {
  id: string;
  name: string;
  role: string;
  state: AgentState;
  x: number; // Relative to arena center (-224 to +224)
  y: number; // Relative to arena center (-224 to +224)
  color: string;
  task: string;
}

export type ArenaEventType =
  | 'init_arena'
  | 'zeus_task'
  | 'agent_spawn'
  | 'agent_move'
  | 'agent_state'
  | 'arena_reset';

export interface ArenaWebSocketEvent {
  id?: string;
  type: ArenaEventType;
  prompt?: string;
  agent?: ArenaAgent;
  agents?: ArenaAgent[];
  spawnedAgents?: string[];
  timestamp: string;
  source?: 'websocket' | 'injector' | 'arena_click';
}
