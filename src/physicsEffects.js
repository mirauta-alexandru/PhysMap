import Matter from 'matter-js';
import { config } from './config.js';

const { Body } = Matter;

const EFFECT_COLORS = {
  attractor: '#78aaff',
  repulsor: '#ff5f71',
  vortex: '#bd7dff',
  colorGate: '#63f5c5',
  boostGate: '#ffd65a',
  portal: '#62d8ff',
};

function particles(bodies) {
  return bodies.filter((body) => body.label === 'circle' && !body.isStatic);
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { distance: Math.hypot(px - x, py - y), x, y };
}

function crossedGate(body, effect) {
  const current = body.position;
  const previous = body.render?.previousPosition || current;
  const side = (point) =>
    (effect.bx - effect.ax) * (point.y - effect.ay) -
    (effect.by - effect.ay) * (point.x - effect.ax);
  const crossed = side(previous) * side(current) <= 0;
  const near = pointSegmentDistance(
    current.x,
    current.y,
    effect.ax,
    effect.ay,
    effect.bx,
    effect.by,
  ).distance < Math.max(20, body.circleRadius || body.render?.size || 12);
  return crossed && near;
}

function applyRadial(body, effect, mode) {
  const dx = effect.x - body.position.x;
  const dy = effect.y - body.position.y;
  const distance = Math.hypot(dx, dy) || 1;
  const radius = effect.radius || 150;
  if (distance > radius) return;

  const falloff = 1 - distance / radius;
  const strength = (effect.strength || 0.00075) * falloff * body.mass;
  const nx = dx / distance;
  const ny = dy / distance;

  if (mode === 'attractor') {
    Body.applyForce(body, body.position, { x: nx * strength, y: ny * strength });
  } else if (mode === 'repulsor') {
    Body.applyForce(body, body.position, { x: -nx * strength * 1.35, y: -ny * strength * 1.35 });
  } else {
    Body.applyForce(body, body.position, {
      x: (nx * 0.38 - ny) * strength * 1.2,
      y: (ny * 0.38 + nx) * strength * 1.2,
    });
  }
}

function applyColorGate(body, effect, now) {
  if (!crossedGate(body, effect)) return;
  const last = body.render?.lastGateAt || 0;
  if (now - last < 220) return;
  body.render.color = effect.color || '#63f5c5';
  body.render.pulse = 0;
  body.render.lastGateAt = now;
}

function applyBoostGate(body, effect, now) {
  if (!crossedGate(body, effect)) return;
  const last = body.render?.lastBoostAt || 0;
  if (now - last < 260) return;
  const dx = effect.bx - effect.ax;
  const dy = effect.by - effect.ay;
  const length = Math.hypot(dx, dy) || 1;
  const direction = effect.direction || 1;
  const nx = (-dy / length) * direction;
  const ny = (dx / length) * direction;
  const speed = effect.power || 13;
  Body.setVelocity(body, {
    x: body.velocity.x * 0.35 + nx * speed,
    y: body.velocity.y * 0.35 + ny * speed,
  });
  body.render.lastBoostAt = now;
  body.render.pulse = 0;
}

function applyPortal(body, effect, now) {
  const cooldown = body.render?.portalCooldown || 0;
  if (now < cooldown) return;
  const radius = effect.radius || 30;
  const da = Math.hypot(body.position.x - effect.ax, body.position.y - effect.ay);
  const db = Math.hypot(body.position.x - effect.bx, body.position.y - effect.by);
  let target = null;
  let source = null;
  if (da < radius) {
    source = { x: effect.ax, y: effect.ay };
    target = { x: effect.bx, y: effect.by };
  } else if (db < radius) {
    source = { x: effect.bx, y: effect.by };
    target = { x: effect.ax, y: effect.ay };
  }
  if (!target) return;

  const velocityLength = Math.hypot(body.velocity.x, body.velocity.y) || 1;
  const offsetX = (body.velocity.x / velocityLength) * (radius + 8);
  const offsetY = (body.velocity.y / velocityLength) * (radius + 8);
  Body.setPosition(body, { x: target.x + offsetX, y: target.y + offsetY });
  Body.setVelocity(body, { x: body.velocity.x * 1.08, y: body.velocity.y * 1.08 });
  body.render.portalCooldown = now + 420;
  body.render.portalFlash = { x: source.x, y: source.y, at: now };
}

function updateTrail(body) {
  if (!body.render) return;
  const trail = body.render.trail || (body.render.trail = []);
  const last = trail[trail.length - 1];
  if (!last || Math.hypot(last.x - body.position.x, last.y - body.position.y) > 5) {
    trail.push({ x: body.position.x, y: body.position.y });
    if (trail.length > 12) trail.shift();
  }
  body.render.previousPosition = { x: body.position.x, y: body.position.y };
}

export function updatePhysicsEffects(effects, bodies, now) {
  const dynamic = particles(bodies);
  for (const body of dynamic) {
    if (!body.render) body.render = { color: '#ffffff', kind: 'orb', trail: [] };
    const previous = body.render.previousPosition || {
      x: body.position.x - body.velocity.x,
      y: body.position.y - body.velocity.y,
    };
    body.render.previousPosition = previous;

    for (const effect of effects || []) {
      if (effect.type === 'attractor') applyRadial(body, effect, 'attractor');
      else if (effect.type === 'repulsor') applyRadial(body, effect, 'repulsor');
      else if (effect.type === 'vortex') applyRadial(body, effect, 'vortex');
      else if (effect.type === 'colorGate') applyColorGate(body, effect, now);
      else if (effect.type === 'boostGate') applyBoostGate(body, effect, now);
      else if (effect.type === 'portal') applyPortal(body, effect, now);
    }
    updateTrail(body);
  }
}

function glowStroke(ctx, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
}

function drawLabel(ctx, text, x, y, color) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.font = '10px Silkscreen, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(5, 9, 11, 0.82)';
  ctx.fillRect(x - width / 2, y - 10, width, 20);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - width / 2, y - 10, width, 20);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function drawPointEffect(ctx, effect, now, editMode, selected) {
  const color = EFFECT_COLORS[effect.type];
  const radius = effect.radius || 150;
  const phase = now * 0.0025 + (effect.id || 0);
  ctx.save();
  ctx.translate(effect.x, effect.y);
  ctx.globalAlpha = editMode ? 0.72 : 0.9;
  glowStroke(ctx, color, 2);
  if (selected) {
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 24;
  }

  if (editMode) {
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (let i = 0; i < 3; i++) {
    const ring = 18 + ((phase * 20 + i * 18) % 54);
    ctx.globalAlpha = 0.85 - ring / 110;
    ctx.beginPath();
    ctx.arc(0, 0, ring, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  if (effect.type === 'vortex') {
    ctx.beginPath();
    for (let i = 0; i < 42; i++) {
      const angle = phase * 2 + i * 0.42;
      const r = 2 + i * 0.72;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 7 + Math.sin(phase * 3) * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (editMode) {
    const names = { attractor: 'GRAVITY', repulsor: 'REPULSE', vortex: 'VORTEX' };
    drawLabel(ctx, names[effect.type], 0, -30, color);
  }
  ctx.restore();
}

function drawGate(ctx, effect, now, editMode, selected) {
  const color = effect.type === 'colorGate'
    ? (effect.color || EFFECT_COLORS.colorGate)
    : EFFECT_COLORS[effect.type];
  const dx = effect.bx - effect.ax;
  const dy = effect.by - effect.ay;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const phase = (now * 0.12) % 22;
  ctx.save();
  glowStroke(ctx, color, effect.type === 'boostGate' ? 3 : 2);
  if (selected) {
    ctx.lineWidth += 2;
    ctx.shadowBlur = 24;
  }
  ctx.setLineDash(effect.type === 'colorGate' ? [10, 7] : [16, 6]);
  ctx.lineDashOffset = -phase;
  ctx.beginPath();
  ctx.moveTo(effect.ax, effect.ay);
  ctx.lineTo(effect.bx, effect.by);
  ctx.stroke();
  ctx.setLineDash([]);

  if (effect.type === 'boostGate') {
    const direction = effect.direction || 1;
    for (let t = 0.16; t < 0.94; t += 0.22) {
      const x = effect.ax + dx * t;
      const y = effect.ay + dy * t;
      ctx.beginPath();
      ctx.moveTo(x - nx * direction * 7 - dx / length * 5, y - ny * direction * 7 - dy / length * 5);
      ctx.lineTo(x + nx * direction * 7, y + ny * direction * 7);
      ctx.lineTo(x - nx * direction * 7 + dx / length * 5, y - ny * direction * 7 + dy / length * 5);
      ctx.stroke();
    }
  }

  if (editMode) {
    ctx.fillStyle = color;
    for (const point of [[effect.ax, effect.ay], [effect.bx, effect.by]]) {
      ctx.fillRect(point[0] - 4, point[1] - 4, 8, 8);
    }
    drawLabel(
      ctx,
      effect.type === 'boostGate' ? 'BOOST GATE' : 'COLOR GATE',
      (effect.ax + effect.bx) / 2,
      (effect.ay + effect.by) / 2 - 18,
      color,
    );
  }
  ctx.restore();
}

function drawPortal(ctx, effect, now, editMode, selected) {
  const color = EFFECT_COLORS.portal;
  const radius = effect.radius || 30;
  const phase = now * 0.003;
  ctx.save();
  glowStroke(ctx, color, 3);
  if (selected) {
    ctx.lineWidth = 5;
    ctx.shadowBlur = 26;
  }
  ctx.globalAlpha = editMode ? 0.48 : 0.28;
  ctx.setLineDash([3, 10]);
  ctx.lineDashOffset = -now * 0.03;
  ctx.beginPath();
  ctx.moveTo(effect.ax, effect.ay);
  ctx.lineTo(effect.bx, effect.by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  for (const [x, y, direction] of [[effect.ax, effect.ay, 1], [effect.bx, effect.by, -1]]) {
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.9 - i * 0.22;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        radius - i * 6,
        radius * 0.62 - i * 3,
        phase * direction + i * 0.4,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }
  if (editMode) {
    drawLabel(ctx, 'PORTAL A', effect.ax, effect.ay - radius - 15, color);
    drawLabel(ctx, 'PORTAL B', effect.bx, effect.by - radius - 15, color);
  }
  ctx.restore();
}

export function drawPhysicsEffects(ctx, effects, now, editMode = false, selectedEffectId = null) {
  for (const effect of effects || []) {
    const selected = editMode && effect.id === selectedEffectId;
    if (['attractor', 'repulsor', 'vortex'].includes(effect.type)) {
      drawPointEffect(ctx, effect, now, editMode, selected);
    } else if (effect.type === 'colorGate' || effect.type === 'boostGate') {
      drawGate(ctx, effect, now, editMode, selected);
    } else if (effect.type === 'portal') {
      drawPortal(ctx, effect, now, editMode, selected);
    }
  }
}

export function effectDefaults(type, data) {
  if (['attractor', 'repulsor', 'vortex'].includes(type)) {
    return {
      type,
      x: data.x,
      y: data.y,
      radius: type === 'vortex' ? 180 : 150,
      strength: type === 'repulsor' ? 0.001 : 0.0008,
    };
  }
  if (type === 'portal') {
    return { type, ax: data.ax, ay: data.ay, bx: data.bx, by: data.by, radius: 30 };
  }
  return {
    type,
    ax: data.ax,
    ay: data.ay,
    bx: data.bx,
    by: data.by,
    direction: 1,
    power: 13,
    color: type === 'colorGate' ? '#63f5c5' : undefined,
  };
}

export { EFFECT_COLORS };
