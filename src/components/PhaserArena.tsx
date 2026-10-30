import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Phaser from 'phaser';
import { AgentState, ArenaAgent, ArenaWebSocketEvent } from '../types/arena';

export const ARENA_RADIUS = 250;
export const MAX_AGENT_RADIUS = ARENA_RADIUS - 26;

// Task countdown durations (ms) for circular progress bar overlay
const MOVING_PROGRESS_DURATION_MS = 2200;
const ORCHESTRATING_PROGRESS_DURATION_MS = 3400;
const PROGRESS_COMPLETE_HOLD_MS = 320;

export interface PhaserArenaHandle {
  dispatchEventToScene: (event: ArenaWebSocketEvent) => void;
  setZoom: (zoom: number) => void;
  resetCamera: () => void;
  setGridVisible: (visible: boolean) => void;
}

interface PhaserArenaProps {
  onAgentDragMove: (agent: ArenaAgent) => void;
  onSelectAgent: (agentId: string) => void;
  selectedAgentId: string | null;
  onSceneReady?: () => void;
}

interface StateVisualSpec {
  ringHex: number;
  textHex: string;
  iconKey: string;
  symbol: string;
  pulseScale: number;
  pulseDuration: number;
}

interface AgentProgressState {
  active: boolean;
  progress: number; // 0.0 -> 1.0
  durationMs: number;
  holdElapsedMs: number;
  stateKey: string;
  ringHex: number;
}

const STATE_VISUAL_CONFIG: Record<string, StateVisualSpec> = {
  orchestrating: {
    ringHex: 0xfef08a,
    textHex: '#FEF08A',
    iconKey: 'state-icon-orchestrating',
    symbol: '⚡',
    pulseScale: 1.48,
    pulseDuration: 620,
  },
  coding: {
    ringHex: 0x10b981,
    textHex: '#34D399',
    iconKey: 'state-icon-coding',
    symbol: '</>',
    pulseScale: 1.34,
    pulseDuration: 820,
  },
  active: {
    ringHex: 0x10b981,
    textHex: '#34D399',
    iconKey: 'state-icon-coding',
    symbol: '●',
    pulseScale: 1.34,
    pulseDuration: 820,
  },
  moving: {
    ringHex: 0x38bdf8,
    textHex: '#38BDF8',
    iconKey: 'state-icon-moving',
    symbol: '»',
    pulseScale: 1.55,
    pulseDuration: 420,
  },
  reviewing: {
    ringHex: 0xa855f7,
    textHex: '#C084FC',
    iconKey: 'state-icon-reviewing',
    symbol: '◈',
    pulseScale: 1.28,
    pulseDuration: 960,
  },
  idle: {
    ringHex: 0x64748b,
    textHex: '#94A3B8',
    iconKey: 'state-icon-idle',
    symbol: '⏸',
    pulseScale: 1.1,
    pulseDuration: 1500,
  },
};

class TartarusArenaScene extends Phaser.Scene {
  private arenaGraphics!: Phaser.GameObjects.Graphics;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private selectionRing!: Phaser.GameObjects.Graphics;
  private dragConstraintRing!: Phaser.GameObjects.Graphics;
  private agentContainers: Map<string, Phaser.GameObjects.Container> = new Map();
  private agentDataMap: Map<string, ArenaAgent> = new Map();
  private draggingAgentIds: Set<string> = new Set();
  private agentProgressMap: Map<string, AgentProgressState> = new Map();
  private center = { x: 0, y: 0 };
  private showGrid = true;
  private selectedId: string | null = null;
  private isCreated = false;
  private onAgentDragEnd?: (agent: ArenaAgent) => void;
  private onAgentSelect?: (id: string) => void;
  private onReadyCallback?: () => void;

  constructor() {
    super({ key: 'TartarusArenaScene' });
  }

  init(data: {
    onAgentDragEnd?: (agent: ArenaAgent) => void;
    onAgentSelect?: (id: string) => void;
    onReadyCallback?: () => void;
  }) {
    this.onAgentDragEnd = data.onAgentDragEnd;
    this.onAgentSelect = data.onAgentSelect;
    this.onReadyCallback = data.onReadyCallback;
  }

  create() {
    this.center = {
      x: Math.round(this.scale.width / 2),
      y: Math.round(this.scale.height / 2),
    };

    this.agentContainers.clear();
    this.agentDataMap.clear();
    this.draggingAgentIds.clear();
    this.agentProgressMap.clear();

    this.arenaGraphics = this.add.graphics();
    this.gridGraphics = this.add.graphics();
    this.dragConstraintRing = this.add.graphics();
    this.selectionRing = this.add.graphics();

    this.generatePantheonPixelTextures();
    this.generateStateIconTextures();
    this.renderCircularArena();
    this.registerDragAndDropListeners();
    this.isCreated = true;

    if (this.onReadyCallback) {
      this.onReadyCallback();
    }

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.center = {
        x: Math.round(gameSize.width / 2),
        y: Math.round(gameSize.height / 2),
      };
      this.renderCircularArena();

      this.agentDataMap.forEach((agent, id) => {
        const container = this.agentContainers.get(id);
        if (container) {
          container.setPosition(
            this.center.x + agent.x,
            this.center.y + agent.y
          );
        }
      });
      this.drawSelectionHighlight();
    });
  }

  update(_time: number, delta: number) {
    if (!this.isCreated) return;
    this.updateAgentCircularProgressBars(delta);
  }

  private emitTaskCompletionSparks(
    worldX: number,
    worldY: number,
    agentColorHex = 0xf59e0b
  ) {
    if (!this.textures.exists('task-spark-particle')) return;

    const sparkEmitter = this.add
      .particles(worldX, worldY, 'task-spark-particle', {
        speed: { min: 26, max: 78 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.15, end: 0 },
        alpha: { start: 0.95, end: 0 },
        lifespan: { min: 300, max: 520 },
        gravityY: -20,
        tint: [agentColorHex, 0xfef08a, 0x10b981],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(16);

    sparkEmitter.explode(14, 0, 0);

    this.time.delayedCall(580, () => {
      sparkEmitter.destroy();
    });
  }

  private updateAgentCircularProgressBars(delta: number) {
    const dt = Math.min(Math.max(delta, 4), 100);

    this.agentProgressMap.forEach((progState, agentId) => {
      const container = this.agentContainers.get(agentId);
      const agent = this.agentDataMap.get(agentId);
      if (!container || !agent) return;

      const progressGraphics = container.getByName(
        'progressArc'
      ) as Phaser.GameObjects.Graphics | null;
      if (!progressGraphics) return;

      progressGraphics.clear();

      if (!progState.active) {
        return;
      }

      if (progState.progress < 1) {
        const nextProgress = Math.min(
          1,
          progState.progress + dt / progState.durationMs
        );
        if (progState.progress < 1 && nextProgress >= 1) {
          const agentColorNum = Phaser.Display.Color.HexStringToColor(
            agent.color || '#F59E0B'
          ).color;
          this.emitTaskCompletionSparks(
            container.x,
            container.y,
            agentColorNum
          );
        }
        progState.progress = nextProgress;
      } else {
        progState.holdElapsedMs += dt;
        if (progState.holdElapsedMs >= PROGRESS_COMPLETE_HOLD_MS) {
          progState.progress = 0;
          progState.holdElapsedMs = 0;
        }
      }

      this.drawCircularProgressOverlay(
        progressGraphics,
        progState.progress,
        progState.ringHex
      );

      // State badge displays only state symbol + state label (no (X, Y) coordinates)
      const stateBadge = container.getByName(
        'stateBadge'
      ) as Phaser.GameObjects.Text | null;
      if (stateBadge) {
        const spec = this.getStateVisualSpec(progState.stateKey);
        stateBadge.setText(`${spec.symbol} ${progState.stateKey.toUpperCase()}`);
      }
    });
  }

  private drawCircularProgressOverlay(
    g: Phaser.GameObjects.Graphics,
    progress: number,
    colorHex: number
  ) {
    const centerX = 0;
    const centerY = -1;
    const radius = 16;
    const startAngle = -Math.PI / 2;
    const clampedProgress = Phaser.Math.Clamp(progress, 0, 1);
    const endAngle = startAngle + clampedProgress * Math.PI * 2;

    g.lineStyle(4, 0x090d16, 0.9);
    g.strokeCircle(centerX, centerY, radius);

    g.lineStyle(2, 0x1e293b, 0.95);
    g.strokeCircle(centerX, centerY, radius);

    if (clampedProgress > 0.01) {
      const activeColor = clampedProgress >= 0.99 ? 0x10b981 : colorHex;
      g.lineStyle(2.5, activeColor, 0.98);
      g.beginPath();
      g.arc(centerX, centerY, radius, startAngle, endAngle, false);
      g.strokePath();

      const tipX = centerX + Math.cos(endAngle) * radius;
      const tipY = centerY + Math.sin(endAngle) * radius;
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(tipX, tipY, 2);
    }
  }

  private syncAgentProgressState(
    agentId: string,
    state: AgentState | string,
    resetProgress = false
  ) {
    const normState = (state || 'idle').toLowerCase();
    const isProgressActive =
      normState === 'moving' || normState === 'orchestrating';
    const spec = this.getStateVisualSpec(normState);
    const durationMs =
      normState === 'moving'
        ? MOVING_PROGRESS_DURATION_MS
        : ORCHESTRATING_PROGRESS_DURATION_MS;

    const existing = this.agentProgressMap.get(agentId);

    if (!isProgressActive) {
      this.agentProgressMap.set(agentId, {
        active: false,
        progress: 0,
        durationMs,
        holdElapsedMs: 0,
        stateKey: normState,
        ringHex: spec.ringHex,
      });
      const container = this.agentContainers.get(agentId);
      const progressGraphics = container?.getByName(
        'progressArc'
      ) as Phaser.GameObjects.Graphics | null;
      if (progressGraphics) {
        progressGraphics.clear();
      }
      return;
    }

    if (
      !existing ||
      !existing.active ||
      existing.stateKey !== normState ||
      resetProgress
    ) {
      this.agentProgressMap.set(agentId, {
        active: true,
        progress: 0.04,
        durationMs,
        holdElapsedMs: 0,
        stateKey: normState,
        ringHex: spec.ringHex,
      });
    } else {
      existing.ringHex = spec.ringHex;
      existing.durationMs = durationMs;
    }
  }

  public isSceneReady(): boolean {
    return this.isCreated;
  }

  private getStateVisualSpec(state: string): StateVisualSpec {
    const key = (state || 'idle').toLowerCase();
    return STATE_VISUAL_CONFIG[key] || STATE_VISUAL_CONFIG.idle;
  }

  private generateStateIconTextures() {
    if (!this.textures.exists('task-spark-particle')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 0.45);
      g.fillRect(2, 0, 2, 6);
      g.fillRect(0, 2, 6, 2);
      g.fillStyle(0xffffff, 1);
      g.fillRect(2, 2, 2, 2);
      g.generateTexture('task-spark-particle', 6, 6);
      g.destroy();
    }

    if (!this.textures.exists('state-icon-orchestrating')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x090d16, 0.95);
      g.fillCircle(6, 6, 6);
      g.fillStyle(0xfef08a, 1);
      g.fillRect(6, 2, 3, 3);
      g.fillRect(4, 5, 5, 2);
      g.fillRect(5, 7, 3, 3);
      g.generateTexture('state-icon-orchestrating', 12, 12);
      g.destroy();
    }

    if (!this.textures.exists('state-icon-coding')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x090d16, 0.95);
      g.fillCircle(6, 6, 6);
      g.fillStyle(0x10b981, 1);
      g.fillRect(3, 5, 2, 2);
      g.fillRect(5, 3, 2, 2);
      g.fillRect(5, 7, 2, 2);
      g.fillRect(8, 5, 2, 2);
      g.generateTexture('state-icon-coding', 12, 12);
      g.destroy();
    }

    if (!this.textures.exists('state-icon-moving')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x090d16, 0.95);
      g.fillCircle(6, 6, 6);
      g.fillStyle(0x38bdf8, 1);
      g.fillRect(3, 3, 2, 2);
      g.fillRect(5, 5, 2, 2);
      g.fillRect(3, 7, 2, 2);
      g.fillRect(7, 3, 2, 2);
      g.fillRect(9, 5, 2, 2);
      g.fillRect(7, 7, 2, 2);
      g.generateTexture('state-icon-moving', 12, 12);
      g.destroy();
    }

    if (!this.textures.exists('state-icon-reviewing')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x090d16, 0.95);
      g.fillCircle(6, 6, 6);
      g.fillStyle(0xa855f7, 1);
      g.fillRect(5, 2, 2, 2);
      g.fillRect(2, 5, 2, 2);
      g.fillRect(8, 5, 2, 2);
      g.fillRect(5, 8, 2, 2);
      g.fillStyle(0xf3e8ff, 1);
      g.fillRect(5, 5, 2, 2);
      g.generateTexture('state-icon-reviewing', 12, 12);
      g.destroy();
    }

    if (!this.textures.exists('state-icon-idle')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x090d16, 0.95);
      g.fillCircle(6, 6, 6);
      g.fillStyle(0x94a3b8, 1);
      g.fillRect(3, 3, 2, 6);
      g.fillRect(7, 3, 2, 6);
      g.generateTexture('state-icon-idle', 12, 12);
      g.destroy();
    }
  }

  private applyAgentStateVisuals(
    container: Phaser.GameObjects.Container,
    state: AgentState | string,
    resetProgress = false
  ) {
    const spec = this.getStateVisualSpec(state);
    const agentId = container.getData('agentId') as string | undefined;

    if (agentId) {
      this.syncAgentProgressState(agentId, state, resetProgress);
    }

    const statePulseRing = container.getByName(
      'statePulseRing'
    ) as Phaser.GameObjects.Ellipse | null;
    if (statePulseRing) {
      this.tweens.killTweensOf(statePulseRing);
      statePulseRing.setScale(1);
      statePulseRing.setAlpha(0.9);
      statePulseRing.setStrokeStyle(2, spec.ringHex, 0.95);
      statePulseRing.setFillStyle(spec.ringHex, 0.14);

      this.tweens.add({
        targets: statePulseRing,
        scaleX: spec.pulseScale,
        scaleY: spec.pulseScale,
        alpha: 0.08,
        duration: spec.pulseDuration,
        repeat: -1,
        ease: 'Sine.easeOut',
      });
    }

    const stateIcon = container.getByName(
      'stateIcon'
    ) as Phaser.GameObjects.Image | null;
    if (stateIcon && this.textures.exists(spec.iconKey)) {
      stateIcon.setTexture(spec.iconKey);
    }

    const stateBadge = container.getByName(
      'stateBadge'
    ) as Phaser.GameObjects.Text | null;
    if (stateBadge) {
      stateBadge.setText(`${spec.symbol} ${state.toUpperCase()}`);
      stateBadge.setColor(spec.textHex);
    }
  }

  private clampCoordinatesToArena(
    relX: number,
    relY: number
  ): { x: number; y: number } {
    const dist = Math.hypot(relX, relY);
    if (dist > MAX_AGENT_RADIUS && dist > 0) {
      const scale = MAX_AGENT_RADIUS / dist;
      return {
        x: Math.round(relX * scale),
        y: Math.round(relY * scale),
      };
    }
    return {
      x: Math.round(relX),
      y: Math.round(relY),
    };
  }

  /**
   * Strict Drag-and-Drop Movement:
   * Autonomous movement, Catmull-Rom splines, and movement trails are completely disabled.
   * Agents only move when manually dragged by the user, emitting `agent_move` on `dragend`.
   */
  private registerDragAndDropListeners() {
    this.input.on(
      'dragstart',
      (
        _pointer: Phaser.Input.Pointer,
        gameObject: Phaser.GameObjects.Container
      ) => {
        const agentId = gameObject.getData('agentId') as string | undefined;
        if (!agentId) return;

        this.draggingAgentIds.add(agentId);
        this.selectedId = agentId;
        this.tweens.killTweensOf(gameObject);
        gameObject.setDepth(20);
        gameObject.setAlpha(1);
        gameObject.setScale(1.08);

        this.applyAgentStateVisuals(gameObject, 'moving', true);

        this.dragConstraintRing.clear();
        this.dragConstraintRing.lineStyle(1.5, 0xf59e0b, 0.55);
        this.dragConstraintRing.strokeCircle(
          this.center.x,
          this.center.y,
          MAX_AGENT_RADIUS
        );

        this.drawSelectionHighlight();
        if (this.onAgentSelect) {
          this.onAgentSelect(agentId);
        }
      }
    );

    this.input.on(
      'drag',
      (
        _pointer: Phaser.Input.Pointer,
        gameObject: Phaser.GameObjects.Container,
        dragX: number,
        dragY: number
      ) => {
        const agentId = gameObject.getData('agentId') as string | undefined;
        if (!agentId) return;

        gameObject.setPosition(dragX, dragY);
        this.drawSelectionHighlight();
      }
    );

    this.input.on(
      'dragend',
      (
        _pointer: Phaser.Input.Pointer,
        gameObject: Phaser.GameObjects.Container
      ) => {
        const agentId = gameObject.getData('agentId') as string | undefined;
        if (!agentId) return;

        this.draggingAgentIds.delete(agentId);
        this.dragConstraintRing.clear();
        gameObject.setDepth(5);
        gameObject.setScale(1);

        const rawRelX = gameObject.x - this.center.x;
        const rawRelY = gameObject.y - this.center.y;
        const clamped = this.clampCoordinatesToArena(rawRelX, rawRelY);

        const finalScreenX = this.center.x + clamped.x;
        const finalScreenY = this.center.y + clamped.y;

        gameObject.setPosition(finalScreenX, finalScreenY);
        this.drawSelectionHighlight();

        const existing = this.agentDataMap.get(agentId);
        const colorNum = Phaser.Display.Color.HexStringToColor(
          existing?.color || '#F59E0B'
        ).color;

        if (existing) {
          const updatedAgent: ArenaAgent = {
            ...existing,
            state: 'moving',
            x: clamped.x,
            y: clamped.y,
          };
          this.agentDataMap.set(agentId, updatedAgent);

          this.applyAgentStateVisuals(gameObject, updatedAgent.state, true);
          this.triggerClickRipple(finalScreenX, finalScreenY, colorNum);

          if (this.onAgentDragEnd) {
            this.onAgentDragEnd(updatedAgent);
          }
        }
      }
    );
  }

  private generatePantheonPixelTextures() {
    const pantheonPalettes: Record<
      string,
      { primary: number; trim: number; eye: number }
    > = {
      zeus: { primary: 0xfef08a, trim: 0xffffff, eye: 0xffffff },
      hades: { primary: 0xa855f7, trim: 0xd8b4fe, eye: 0xf3e8ff },
      helios: { primary: 0xeab308, trim: 0xfde047, eye: 0xfef9c3 },
      poseidon: { primary: 0x38bdf8, trim: 0xbae6fd, eye: 0xe0f2fe },
      hephaestus: { primary: 0xf59e0b, trim: 0xfcd34d, eye: 0xfef3c7 },
      athena: { primary: 0x22d3ee, trim: 0xcffafe, eye: 0xecfeff },
    };

    Object.entries(pantheonPalettes).forEach(([key, pal]) => {
      const texKey = `pantheon-agent-${key}`;
      if (this.textures.exists(texKey)) return;

      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x090d16, 1);
      g.fillRect(4, 2, 16, 18);

      g.fillStyle(pal.trim, 1);
      g.fillRect(7, 1, 10, 3);

      g.fillStyle(pal.primary, 1);
      g.fillRect(6, 4, 12, 13);

      g.fillStyle(0x090d16, 1);
      g.fillRect(7, 7, 10, 4);

      g.fillStyle(pal.eye, 1);
      g.fillRect(8, 8, 3, 2);
      g.fillRect(13, 8, 3, 2);

      g.fillStyle(pal.trim, 1);
      g.fillRect(2, 9, 3, 6);
      g.fillRect(19, 9, 3, 6);

      g.fillStyle(0x334155, 1);
      g.fillRect(6, 20, 4, 3);
      g.fillRect(14, 20, 4, 3);

      g.generateTexture(texKey, 24, 24);
      g.destroy();
    });
  }

  private getTextureKeyForAgent(agent: ArenaAgent): string {
    const idNorm = (agent.id || '').toLowerCase();
    const nameNorm = (agent.name || '').toLowerCase();
    const colorNorm = (agent.color || '').toLowerCase();

    if (
      idNorm.includes('zeus') ||
      nameNorm.includes('zeus') ||
      colorNorm.includes('fef08a') ||
      colorNorm.includes('ffffff')
    ) {
      return 'pantheon-agent-zeus';
    }
    if (
      idNorm.includes('athena') ||
      nameNorm.includes('athena') ||
      colorNorm.includes('22d3ee') ||
      colorNorm.includes('06b6d4')
    ) {
      return 'pantheon-agent-athena';
    }
    if (
      idNorm.includes('hades') ||
      nameNorm.includes('hades') ||
      colorNorm.includes('a855f7') ||
      colorNorm.includes('9333ea')
    ) {
      return 'pantheon-agent-hades';
    }
    if (
      idNorm.includes('helios') ||
      nameNorm.includes('helios') ||
      colorNorm.includes('eab308') ||
      colorNorm.includes('ffd700')
    ) {
      return 'pantheon-agent-helios';
    }
    if (
      idNorm.includes('poseidon') ||
      nameNorm.includes('poseidon') ||
      colorNorm.includes('38bdf8') ||
      colorNorm.includes('0ea5e9')
    ) {
      return 'pantheon-agent-poseidon';
    }
    return 'pantheon-agent-hephaestus';
  }

  public renderCircularArena() {
    const { x: cx, y: cy } = this.center;
    const r = ARENA_RADIUS;

    const g = this.arenaGraphics;
    g.clear();

    g.fillStyle(0x05080f, 0.85);
    g.fillCircle(cx, cy + 26, r + 26);

    g.fillStyle(0x0d1322, 1);
    g.fillCircle(cx, cy + 18, r + 10);
    g.lineStyle(2, 0x1e293b, 1);
    g.strokeCircle(cx, cy + 18, r + 10);

    g.lineStyle(2, 0x1e293b, 0.75);
    for (let angleDeg = 15; angleDeg <= 165; angleDeg += 15) {
      const rad = Phaser.Math.DegToRad(angleDeg);
      const px = cx + Math.cos(rad) * (r + 8);
      const pyTop = cy + Math.sin(rad) * (r + 4);
      const pyBottom = cy + 18 + Math.sin(rad) * (r + 8);
      g.lineBetween(px, pyTop, px, pyBottom);
    }

    g.fillStyle(0x1e293b, 1);
    g.fillCircle(cx, cy, r + 10);
    g.lineStyle(3, 0x334155, 1);
    g.strokeCircle(cx, cy, r + 10);

    g.fillStyle(0x111827, 1);
    g.fillCircle(cx, cy, r);

    g.fillStyle(0x0f172a, 1);
    g.fillCircle(cx, cy, Math.round(r * 0.72));

    g.fillStyle(0x131c31, 1);
    g.fillCircle(cx, cy, Math.round(r * 0.38));

    g.lineStyle(2, 0xf59e0b, 0.35);
    g.strokeCircle(cx, cy, r - 6);

    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const px = Math.round(cx + Math.cos(angle) * (r + 2));
      const py = Math.round(cy + Math.sin(angle) * (r + 2));

      g.fillStyle(0x05080f, 0.9);
      g.fillRect(px - 7, py - 4, 14, 14);
      g.fillStyle(0x334155, 1);
      g.fillRect(px - 6, py - 8, 12, 12);
      g.fillStyle(0xf59e0b, 0.9);
      g.fillRect(px - 2, py - 4, 4, 4);
    }

    this.renderGridOverlay();
  }

  private renderGridOverlay() {
    const { x: cx, y: cy } = this.center;
    const r = ARENA_RADIUS;
    const gg = this.gridGraphics;
    gg.clear();

    if (!this.showGrid) return;

    gg.lineStyle(1, 0x1e293b, 0.9);
    gg.strokeCircle(cx, cy, Math.round(r * 0.72));
    gg.strokeCircle(cx, cy, Math.round(r * 0.38));
    gg.strokeCircle(cx, cy, Math.round(r * 0.14));

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 4;
      const dx = Math.cos(angle) * (r - 8);
      const dy = Math.sin(angle) * (r - 8);
      gg.lineBetween(cx - dx, cy - dy, cx + dx, cy + dy);
    }

    gg.fillStyle(0x334155, 0.55);
    const step = 32;
    for (let gx = -r + 24; gx <= r - 24; gx += step) {
      for (let gy = -r + 24; gy <= r - 24; gy += step) {
        if (Math.hypot(gx, gy) <= r - 18) {
          gg.fillRect(cx + gx - 1, cy + gy - 1, 2, 2);
        }
      }
    }
  }

  private triggerClickRipple(
    worldX: number,
    worldY: number,
    hexColor = 0xf59e0b
  ) {
    const ripple = this.add.circle(worldX, worldY, 4, hexColor, 0);
    ripple.setStrokeStyle(1.5, hexColor, 0.8);
    this.tweens.add({
      targets: ripple,
      radius: 20,
      alpha: 0,
      duration: 240,
      ease: 'Cubic.easeOut',
      onComplete: () => ripple.destroy(),
    });
  }

  public setGridVisibility(visible: boolean) {
    this.showGrid = visible;
    this.renderGridOverlay();
  }

  public setSelectedAgent(agentId: string | null) {
    this.selectedId = agentId;
    this.drawSelectionHighlight();
  }

  private drawSelectionHighlight() {
    if (!this.selectionRing) return;
    this.selectionRing.clear();
    if (!this.selectedId) return;
    const container = this.agentContainers.get(this.selectedId);
    const agent = this.agentDataMap.get(this.selectedId);
    if (!container) return;

    const ringHex = agent?.color
      ? Phaser.Display.Color.HexStringToColor(agent.color).color
      : 0xf59e0b;

    this.selectionRing.lineStyle(2, ringHex, 0.95);
    this.selectionRing.strokeCircle(container.x, container.y + 2, 21);
  }

  public handleServerEvent(payload: ArenaWebSocketEvent) {
    if (!this.isCreated) return;

    if (payload.type === 'init_arena' && Array.isArray(payload.agents)) {
      this.agentContainers.forEach((c) => c.destroy());
      this.agentContainers.clear();
      this.agentDataMap.clear();
      this.agentProgressMap.clear();
      payload.agents.forEach((agent) => this.upsertAgent(agent, 'agent_spawn'));
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
      this.agentProgressMap.clear();
      this.selectionRing.clear();
    }
  }

  private getRoleLabelForAgent(agent: ArenaAgent): string {
    if (agent.role && agent.role.trim().length > 0) {
      return agent.role.trim();
    }
    const idNorm = (agent.id || '').toLowerCase();
    const nameNorm = (agent.name || '').toLowerCase();
    if (idNorm.includes('zeus') || nameNorm.includes('zeus')) {
      return 'Orchestrator';
    }
    if (idNorm.includes('athena') || nameNorm.includes('athena')) {
      return 'Conversational / Chat';
    }
    if (idNorm.includes('hephaestus') || nameNorm.includes('hephaestus')) {
      return 'Database & Backend';
    }
    if (idNorm.includes('helios') || nameNorm.includes('helios')) {
      return 'Frontend';
    }
    if (idNorm.includes('hades') || nameNorm.includes('hades')) {
      return 'Systems & Security';
    }
    if (idNorm.includes('poseidon') || nameNorm.includes('poseidon')) {
      return 'API & Network';
    }
    return 'Specialist';
  }

  /**
   * Spawns or updates an agent statically in the arena.
   * No autonomous pathing, splines, or movement trails occur; only manual user dragging moves agents.
   */
  private upsertAgent(
    agent: ArenaAgent,
    eventType: 'agent_spawn' | 'agent_move' | 'agent_state'
  ) {
    if (this.draggingAgentIds.has(agent.id) && eventType === 'agent_move') {
      return;
    }

    const clamped = this.clampCoordinatesToArena(agent.x, agent.y);
    const updatedAgent: ArenaAgent = {
      ...agent,
      role: this.getRoleLabelForAgent(agent),
      x: clamped.x,
      y: clamped.y,
    };
    this.agentDataMap.set(agent.id, updatedAgent);

    const targetScreenX = this.center.x + clamped.x;
    const targetScreenY = this.center.y + clamped.y;
    const agentColorNum = Phaser.Display.Color.HexStringToColor(
      updatedAgent.color || '#F59E0B'
    ).color;

    if (this.agentContainers.has(agent.id)) {
      const container = this.agentContainers.get(agent.id)!;
      container.setPosition(targetScreenX, targetScreenY);

      const existingRoleTag = container.getByName(
        'roleTag'
      ) as Phaser.GameObjects.Text | null;
      if (existingRoleTag) {
        existingRoleTag.setText(updatedAgent.role);
      }

      const existingNameTag = container.getByName(
        'nameTag'
      ) as Phaser.GameObjects.Text | null;
      if (existingNameTag) {
        existingNameTag.setText(updatedAgent.name);
        existingNameTag.setColor(updatedAgent.color || '#F8FAFC');
      }

      this.applyAgentStateVisuals(container, updatedAgent.state, true);

      if (eventType === 'agent_spawn') {
        this.triggerClickRipple(targetScreenX, targetScreenY, agentColorNum);
        this.playAgentSpawnPopIn(container);
      } else if (
        eventType === 'agent_state' &&
        updatedAgent.state === 'orchestrating'
      ) {
        this.triggerClickRipple(targetScreenX, targetScreenY, agentColorNum);
      }

      if (this.selectedId === agent.id) {
        this.drawSelectionHighlight();
      }
      return;
    }

    this.triggerClickRipple(targetScreenX, targetScreenY, agentColorNum);

    const stateSpec = this.getStateVisualSpec(updatedAgent.state);

    const shadow = this.add.ellipse(0, 12, 24, 9, 0x05080f, 0.8);

    const statePulseRing = this.add
      .ellipse(0, 10, 28, 12, stateSpec.ringHex, 0.14)
      .setStrokeStyle(2, stateSpec.ringHex, 0.95)
      .setName('statePulseRing');

    const colorPedestal = this.add
      .ellipse(0, 10, 20, 7, agentColorNum, 0.3)
      .setStrokeStyle(1.5, agentColorNum, 0.85);

    const progressArc = this.add.graphics().setName('progressArc');

    const spriteKey = this.getTextureKeyForAgent(updatedAgent);
    const sprite = this.add.image(0, 0, spriteKey).setScale(1.2);

    const stateIcon = this.add
      .image(14, -10, stateSpec.iconKey)
      .setScale(1.15)
      .setName('stateIcon');

    const roleTag = this.add
      .text(0, -44, updatedAgent.role, {
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '9px',
        color: '#94A3B8',
        backgroundColor: '#090D16E6',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5)
      .setName('roleTag');

    const nameTag = this.add
      .text(0, -27, updatedAgent.name, {
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '11px',
        color: updatedAgent.color || '#F8FAFC',
        backgroundColor: '#0B0F17E6',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)
      .setName('nameTag');

    const stateBadge = this.add
      .text(
        0,
        24,
        `${stateSpec.symbol} ${updatedAgent.state.toUpperCase()}`,
        {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '10px',
          color: stateSpec.textHex,
          backgroundColor: '#0B0F17CC',
          padding: { x: 4, y: 1 },
        }
      )
      .setOrigin(0.5)
      .setName('stateBadge');

    const container = this.add.container(targetScreenX, targetScreenY, [
      shadow,
      statePulseRing,
      colorPedestal,
      progressArc,
      sprite,
      stateIcon,
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

    this.applyAgentStateVisuals(container, updatedAgent.state, true);
    this.playAgentSpawnPopIn(container);

    this.selectedId = agent.id;
    this.drawSelectionHighlight();
  }

  /**
   * Plays a brief, subtle pop-in scale and fade-in effect in-place when an agent sprite spawns.
   */
  private playAgentSpawnPopIn(container: Phaser.GameObjects.Container) {
    this.tweens.killTweensOf(container);
    container.setScale(0.35);
    container.setAlpha(0);

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

export const PhaserArena = forwardRef<PhaserArenaHandle, PhaserArenaProps>(
  (
    {
      onAgentDragMove,
      onSelectAgent,
      selectedAgentId,
      onSceneReady,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const gameRef = useRef<Phaser.Game | null>(null);
    const pendingEventsRef = useRef<ArenaWebSocketEvent[]>([]);
    const callbacksRef = useRef({
      onAgentDragMove,
      onSelectAgent,
      onSceneReady,
    });

    useEffect(() => {
      callbacksRef.current = {
        onAgentDragMove,
        onSelectAgent,
        onSceneReady,
      };
    }, [onAgentDragMove, onSelectAgent, onSceneReady]);

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
        input: {
          keyboard: false,
        },
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: [TartarusArenaScene],
      });

      game.events.once('ready', () => {
        const scene = game.scene.getScene(
          'TartarusArenaScene'
        ) as TartarusArenaScene;
        if (scene) {
          scene.scene.restart({
            onAgentDragEnd: (agent: ArenaAgent) =>
              callbacksRef.current.onAgentDragMove(agent),
            onAgentSelect: (id: string) =>
              callbacksRef.current.onSelectAgent(id),
            onReadyCallback: () => {
              if (pendingEventsRef.current.length > 0) {
                const queued = [...pendingEventsRef.current];
                pendingEventsRef.current = [];
                queued.forEach((ev) => scene.handleServerEvent(ev));
              }
              if (callbacksRef.current.onSceneReady) {
                callbacksRef.current.onSceneReady();
              }
            },
          });
        }
      });

      gameRef.current = game;

      return () => {
        if (gameRef.current) {
          gameRef.current.destroy(true);
          gameRef.current = null;
        }
      };
    }, []);

    useEffect(() => {
      const scene = gameRef.current?.scene?.getScene(
        'TartarusArenaScene'
      ) as TartarusArenaScene | undefined;
      if (scene && scene.isSceneReady()) {
        scene.setSelectedAgent(selectedAgentId);
      }
    }, [selectedAgentId]);

    useImperativeHandle(ref, () => ({
      dispatchEventToScene: (event: ArenaWebSocketEvent) => {
        const scene = gameRef.current?.scene?.getScene(
          'TartarusArenaScene'
        ) as TartarusArenaScene | undefined;
        if (scene && scene.isSceneReady()) {
          scene.handleServerEvent(event);
        } else {
          pendingEventsRef.current.push(event);
        }
      },
      setZoom: (zoom: number) => {
        const scene = gameRef.current?.scene?.getScene(
          'TartarusArenaScene'
        ) as TartarusArenaScene | undefined;
        if (scene && scene.cameras?.main) {
          scene.cameras.main.setZoom(zoom);
        }
      },
      resetCamera: () => {
        const scene = gameRef.current?.scene?.getScene(
          'TartarusArenaScene'
        ) as TartarusArenaScene | undefined;
        if (scene && scene.cameras?.main) {
          scene.cameras.main.setZoom(1);
          scene.cameras.main.centerOn(
            scene.scale.width / 2,
            scene.scale.height / 2
          );
        }
      },
      setGridVisible: (visible: boolean) => {
        const scene = gameRef.current?.scene?.getScene(
          'TartarusArenaScene'
        ) as TartarusArenaScene | undefined;
        if (scene && scene.isSceneReady()) {
          scene.setGridVisibility(visible);
        }
      },
    }));

    return (
      <div
        ref={containerRef}
        className="w-full h-full bg-[#0B0F17] overflow-hidden select-none"
        aria-label="Project Tartarus 2.5D Circular Arena Canvas"
      />
    );
  }
);
