// Canvas 2D scene: arena, two teams, the rope with its center mark, the beat
// ring and effects. Reads game state only; never changes it.
import {
  beatAround,
  BEAT_WINDOW,
  isBracing,
  isExhausted,
  isResting,
  type GameEvent,
  type MatchState,
  type PlayerState,
} from '../../shared/engine.ts';
import type { Arena, RopeSkin } from '../../shared/cosmetics.ts';

export interface View {
  s: MatchState;
  pos: number; // smoothed rope position for display
  tickF: number; // fractional tick for smooth beat animation
  arena: Arena;
  rope: RopeSkin;
  colors: [string, string];
  reducedMotion: boolean;
  highlight: number[]; // players controlled on this device (for "you" markers)
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; color: string }
interface FloatText { x: number; y: number; text: string; color: string; life: number; size: number }

const BURST_FAIL: Partial<Record<string, string>> = {
  'no-charge': 'Рывок не заряжен — тяни в ритм',
  'no-stamina': 'Мало сил для рывка (нужно 15)',
  bracing: 'Отпусти упор для рывка',
  exhausted: 'Выдохся — подожди',
};

/** Visual effects driven by game events; lives outside the game state. */
export class Fx {
  parts: Particle[] = [];
  texts: FloatText[] = [];
  shake = 0;
  flash = [0, 0]; // per-team pull flash (arm animation)
  beatFlash = 0;
  w = 800;
  h = 450;

  layout() {
    return layout(this.w, this.h);
  }

  on(e: GameEvent, s: MatchState, pos: number) {
    const L = this.layout();
    const teamX = (team: number) => L.cx + pos * L.span + (team === 0 ? -1 : 1) * L.span * 1.3;
    const y = L.ground - L.fig * 1.25;
    switch (e.type) {
      case 'pull': {
        const team = s.players[e.p].team;
        this.flash[team] = 1;
        this.dust(teamX(team), L.ground, e.onBeat ? 8 : 3);
        if (e.onBeat)
          this.text(teamX(team), y, e.sync ? 'СИНХРОН!' : e.combo > 1 ? `В ритм ×${e.combo}` : 'В ритм!', e.sync ? '#ffd23f' : '#ffffff', e.sync ? 26 : 20);
        break;
      }
      case 'burst': {
        const team = s.players[e.p].team;
        this.shake = e.result === 'blocked' ? 6 : 14;
        this.dust(teamX(team), L.ground, 30);
        const label = e.result === 'blocked' ? 'ОТБИТ!' : e.result === 'break' ? 'СРЫВ!' : 'РЫВОК!';
        this.text(L.cx + pos * L.span, L.ropeY - L.fig * 0.9, e.teamBurst ? `КОМАНДНЫЙ ${label}` : label, e.result === 'blocked' ? '#9fd3ff' : '#ffd23f', 40);
        break;
      }
      case 'exhausted':
        this.text(teamX(s.players[e.p].team), y - 20, 'Выдохся…', '#ff9a9a', 22);
        break;
      case 'burstReady':
        this.text(teamX(s.players[e.p].team), y - 40, 'Рывок готов!', '#ffd23f', 18);
        break;
      case 'beat':
        this.beatFlash = 1;
        break;
      case 'tempo':
        this.text(L.cx + pos * L.span, L.ropeY - L.fig * 1.6, e.faster ? 'Темп быстрее ▲' : 'Темп медленнее ▼', '#ffd23f', 24);
        break;
      case 'burstFail':
        this.text(teamX(s.players[e.p].team), y - 40, BURST_FAIL[e.reason] ?? 'Рывок недоступен', '#ff9a9a', 18);
        break;
    }
  }

  dust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++)
      this.parts.push({
        x: x + (Math.random() - 0.5) * 60,
        y,
        vx: (Math.random() - 0.5) * 120,
        vy: -Math.random() * 90 - 20,
        life: 0,
        max: 0.5 + Math.random() * 0.5,
        r: 3 + Math.random() * 6,
        color: 'rgba(120, 90, 60, 0.45)',
      });
  }

  text(x: number, y: number, text: string, color: string, size: number) {
    this.texts.push({ x, y, text, color, life: 0, size });
    if (this.texts.length > 12) this.texts.shift();
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const t of this.texts) {
      t.life += dt;
      t.y -= 40 * dt;
    }
    this.texts = this.texts.filter((t) => t.life < 1.1);
    this.shake = Math.max(0, this.shake - dt * 40);
    this.flash = this.flash.map((f) => Math.max(0, f - dt * 5));
    this.beatFlash = Math.max(0, this.beatFlash - dt * 4);
  }
}

function layout(w: number, h: number) {
  const portrait = w / h < 0.8;
  const count = portrait ? 2 : 3; // tuggers drawn per team
  const ground = h * (portrait ? 0.66 : 0.74);
  const fig = Math.min(h * 0.24, w * (portrait ? 0.13 : 0.09));
  const span = w * 0.16; // distance from center to each team line
  return { cx: w / 2, ground, fig, span, count, ropeY: ground - fig * 0.62, gap: fig * 0.85 };
}

const snowflakes = Array.from({ length: 60 }, (_, i) => ({ x: (i * 97) % 100, y: (i * 53) % 100, s: 1 + (i % 3) }));
const stars = Array.from({ length: 50 }, (_, i) => ({ x: (i * 61) % 100, y: (i * 37) % 45, s: (i % 3) * 0.5 + 0.5 }));

export function draw(c: CanvasRenderingContext2D, w: number, h: number, v: View, fx: Fx, time: number) {
  const L = layout(w, h);
  const { arena, s } = v;
  c.save();
  if (fx.shake && !v.reducedMotion) c.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);

  // Sky and decoration.
  const sky = c.createLinearGradient(0, 0, 0, L.ground);
  sky.addColorStop(0, arena.sky[0]);
  sky.addColorStop(1, arena.sky[1]);
  c.fillStyle = sky;
  c.fillRect(-20, -20, w + 40, L.ground + 20);
  if (arena.night) {
    c.fillStyle = '#fff';
    for (const st of stars) {
      c.globalAlpha = 0.4 + 0.4 * Math.sin(time / 600 + st.x);
      c.fillRect((st.x / 100) * w, (st.y / 100) * h, st.s * 2, st.s * 2);
    }
    c.globalAlpha = 1;
    for (const lx of [0.08, 0.92]) {
      c.fillStyle = '#556';
      c.fillRect(lx * w - 3, h * 0.12, 6, L.ground - h * 0.12);
      const g = c.createRadialGradient(lx * w, h * 0.12, 2, lx * w, h * 0.12, h * 0.25);
      g.addColorStop(0, 'rgba(255,255,220,0.9)');
      g.addColorStop(1, 'rgba(255,255,220,0)');
      c.fillStyle = g;
      c.fillRect(lx * w - h * 0.25, 0, h * 0.5, h * 0.4);
    }
  } else if (arena.id === 'beach') {
    c.fillStyle = '#fff3c4';
    c.beginPath();
    c.arc(w * 0.8, h * 0.2, h * 0.08, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = arena.accent;
    c.fillRect(0, L.ground - h * 0.06, w, h * 0.06);
  } else {
    // Schoolyard: school building silhouette and clouds.
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [cx, cy, r] of [[0.15, 0.15, 0.05], [0.2, 0.13, 0.04], [0.7, 0.1, 0.045], [0.75, 0.12, 0.035]]) {
      c.beginPath();
      c.arc(((cx + time / 400000) % 1.1) * w, cy * h, r * w, 0, Math.PI * 2);
      c.fill();
    }
    if (!arena.snow) {
      c.fillStyle = '#e8c9a0';
      c.fillRect(w * 0.3, L.ground - h * 0.3, w * 0.4, h * 0.3);
      c.fillStyle = arena.accent;
      c.fillRect(w * 0.28, L.ground - h * 0.33, w * 0.44, h * 0.04);
      c.fillStyle = '#9fd0ef';
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) c.fillRect(w * (0.33 + i * 0.058), L.ground - h * (0.26 - j * 0.1), w * 0.03, h * 0.06);
    } else {
      c.fillStyle = '#dfe7f5';
      c.beginPath();
      c.moveTo(0, L.ground);
      c.lineTo(w * 0.2, L.ground - h * 0.35);
      c.lineTo(w * 0.42, L.ground);
      c.moveTo(w * 0.35, L.ground);
      c.lineTo(w * 0.62, L.ground - h * 0.45);
      c.lineTo(w * 0.9, L.ground);
      c.fill();
    }
  }

  // Ground with the three lines.
  c.fillStyle = arena.ground;
  c.fillRect(-20, L.ground, w + 40, h - L.ground + 20);
  c.fillStyle = 'rgba(0,0,0,0.06)';
  c.fillRect(-20, L.ground, w + 40, 6);
  const line = (x: number, color: string, dash: boolean) => {
    c.strokeStyle = color;
    c.lineWidth = 5;
    c.setLineDash(dash ? [10, 8] : []);
    c.beginPath();
    c.moveTo(x, L.ground + 4);
    c.lineTo(x - (x - L.cx) * 0.15, h);
    c.stroke();
    c.setLineDash([]);
  };
  line(L.cx, 'rgba(255,255,255,0.7)', true);
  line(L.cx - L.span, v.colors[0], false);
  line(L.cx + L.span, v.colors[1], false);

  if (arena.snow) {
    c.fillStyle = '#fff';
    for (const f of snowflakes) {
      const y = ((f.y / 100) * h + time / (20 / f.s)) % h;
      c.fillRect(((f.x / 100) * w + Math.sin(time / 800 + f.x) * 10) % w, y, f.s * 1.5, f.s * 1.5);
    }
  }

  // Teams and rope.
  const mark = L.cx + v.pos * L.span;
  const hands: number[] = [];
  for (const team of [0, 1] as const) {
    const dir = team === 0 ? -1 : 1;
    const members = s.players.map((p, i) => ({ p, i })).filter((x) => x.p.team === team);
    for (let k = 0; k < L.count; k++) {
      const { p, i } = members[k % members.length];
      const x = mark + dir * (L.span * 1.3 + k * L.gap);
      const hx = figure(c, x, L, v.colors[team], dir, s, p, fx.flash[team], time + k * 170 + team * 90, v.reducedMotion);
      hands.push(hx);
      if (k === 0 && v.highlight.includes(i) && s.phase !== 'finished') {
        c.fillStyle = '#fff';
        c.font = `700 ${Math.round(L.fig * 0.16)}px Rubik, sans-serif`;
        c.textAlign = 'center';
        c.fillText('▼', x, L.ground - L.fig * 1.55);
      }
    }
  }
  drawRope(c, Math.min(...hands) - 20, Math.max(...hands) + 20, L.ropeY, v.rope.colors, time);

  // Center mark: a ribbon hanging from the rope.
  c.fillStyle = '#e5484d';
  c.beginPath();
  c.moveTo(mark - 7, L.ropeY);
  c.lineTo(mark + 7, L.ropeY);
  c.lineTo(mark + 4 + Math.sin(time / 200) * 2, L.ropeY + L.fig * 0.35);
  c.lineTo(mark, L.ropeY + L.fig * 0.28);
  c.lineTo(mark - 4 + Math.sin(time / 200) * 2, L.ropeY + L.fig * 0.35);
  c.closePath();
  c.fill();
  c.strokeStyle = '#fff';
  c.lineWidth = 2;
  c.stroke();

  // Beat ring above the mark.
  if (s.phase === 'playing') drawBeat(c, mark, L.ropeY - L.fig * 1.15, L.fig * 0.22, v, fx);

  for (const p of fx.parts) {
    c.globalAlpha = 1 - p.life / p.max;
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  c.textAlign = 'center';
  for (const t of fx.texts) {
    c.globalAlpha = Math.max(0, 1 - t.life / 1.1);
    const size = t.size * (1 + Math.max(0, 0.2 - t.life));
    c.font = `800 ${Math.round(size * Math.min(1, w / 700) + 4)}px Rubik, sans-serif`;
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(0,0,0,0.45)';
    c.strokeText(t.text, t.x, t.y);
    c.fillStyle = t.color;
    c.fillText(t.text, t.x, t.y);
  }
  c.globalAlpha = 1;
  c.restore();
}

function drawBeat(c: CanvasRenderingContext2D, x: number, y: number, r: number, v: View, fx: Fx) {
  const { prev, next } = beatAround(v.s, v.tickF);
  const period = next - prev;
  const phase = Math.min(1, Math.max(0, (v.tickF - prev) / period));
  const off = Math.min(phase, 1 - phase) * period;
  const inWindow = off <= BEAT_WINDOW;
  c.lineWidth = 4;
  c.strokeStyle = inWindow ? '#3ddc84' : 'rgba(255,255,255,0.85)';
  c.fillStyle = inWindow ? 'rgba(61,220,132,0.35)' : 'rgba(0,0,0,0.18)';
  c.beginPath();
  c.arc(x, y, r * (1 + fx.beatFlash * 0.25), 0, Math.PI * 2);
  c.fill();
  c.stroke();
  // Approach ring shrinks onto the target at the moment of the beat.
  c.strokeStyle = `rgba(255,210,63,${0.35 + phase * 0.65})`;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(x, y, r * (1 + 2 * (1 - phase)), 0, Math.PI * 2);
  c.stroke();
}

function drawRope(c: CanvasRenderingContext2D, x1: number, x2: number, y: number, colors: string[], time: number) {
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = 9;
  c.beginPath();
  c.moveTo(x1, y + 3);
  c.lineTo(x2, y + 3);
  c.stroke();
  c.lineWidth = 7;
  c.strokeStyle = colors[0];
  c.beginPath();
  c.moveTo(x1, y);
  c.lineTo(x2, y);
  c.stroke();
  c.strokeStyle = colors[1];
  c.lineWidth = 3;
  c.setLineDash([6, 8]);
  c.lineDashOffset = -time / 50;
  c.beginPath();
  c.moveTo(x1, y);
  c.lineTo(x2, y);
  c.stroke();
  c.setLineDash([]);
  c.lineCap = 'butt';
}

/** Draws one tugger; returns the x of their hands on the rope. */
function figure(
  c: CanvasRenderingContext2D,
  x: number,
  L: ReturnType<typeof layout>,
  color: string,
  dir: number,
  s: MatchState,
  p: PlayerState,
  flash: number,
  time: number,
  reduced: boolean,
) {
  const f = L.fig;
  const exhausted = isExhausted(s, p);
  const bracing = isBracing(s, p) || p.braceSince >= 0;
  const resting = isResting(s, p) && s.phase === 'playing';
  let lean = 0.35 + Math.min(0.35, p.force * 0.07) + flash * 0.12;
  let crouch = 0;
  if (bracing) {
    lean = 0.75;
    crouch = 0.18;
  }
  if (resting) lean = 0.15;
  if (exhausted) lean = -0.05 + (reduced ? 0 : Math.sin(time / 90) * 0.05);
  if (s.phase === 'countdown') lean = 0.25;
  if (s.phase === 'finished' && s.winner !== 'draw') lean = s.winner === p.team ? -0.1 : 0.05;

  const hip = { x, y: L.ground - f * (0.45 - crouch) };
  // Legs: feet planted towards the rope, knees bent when bracing.
  c.strokeStyle = '#333';
  c.lineWidth = f * 0.09;
  c.lineCap = 'round';
  const footFront = x - dir * f * (0.22 + crouch * 0.4);
  c.beginPath();
  c.moveTo(hip.x, hip.y);
  c.lineTo((hip.x + footFront) / 2 - dir * f * crouch * 0.3, L.ground - f * 0.22);
  c.lineTo(footFront, L.ground);
  c.moveTo(hip.x, hip.y);
  c.lineTo(x + dir * f * 0.1, L.ground);
  c.stroke();

  // Body leans away from the rope (dir points away from the center).
  const bodyLen = f * 0.5;
  const neck = { x: hip.x + dir * Math.sin(lean) * bodyLen, y: hip.y - Math.cos(lean) * bodyLen };
  c.strokeStyle = color;
  c.lineWidth = f * 0.26;
  c.beginPath();
  c.moveTo(hip.x, hip.y);
  c.lineTo(neck.x, neck.y);
  c.stroke();

  // Head.
  const head = { x: neck.x + dir * Math.sin(lean) * f * 0.14, y: neck.y - f * 0.17 };
  c.fillStyle = '#f2c9a0';
  c.beginPath();
  c.arc(head.x, head.y, f * 0.13, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#2b1d14';
  c.beginPath();
  c.arc(head.x + dir * f * 0.02, head.y - f * 0.05, f * 0.12, Math.PI, Math.PI * 2);
  c.fill();
  if (exhausted) {
    c.fillStyle = '#7cc8ff';
    c.beginPath();
    c.arc(head.x - dir * f * 0.17, head.y - f * 0.05 + ((time / 8) % (f * 0.3)), f * 0.035, 0, Math.PI * 2);
    c.fill();
  }

  // Arms reach to the rope in front of the body.
  const handX = x - dir * f * (0.42 + flash * 0.05);
  c.strokeStyle = '#f2c9a0';
  c.lineWidth = f * 0.07;
  c.beginPath();
  c.moveTo(neck.x, neck.y + f * 0.05);
  c.lineTo(handX, L.ropeY);
  c.stroke();
  c.lineCap = 'butt';
  return handX;
}
