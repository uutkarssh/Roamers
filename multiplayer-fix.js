// Multiplayer feel fix: client prediction + smooth reconciliation + responsive touch aim.
(() => {
  const targets = new Map();
  const rendered = new Map();
  let last = performance.now();
  let localTarget = null;

  function remember(list) {
    const items = Array.isArray(list) ? list : Object.values(list || {});
    for (const p of items) {
      if (!p || !p.id) continue;
      const t = { x: Number(p.x), y: Number(p.y) };
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
      targets.set(p.id, t);
      if (!rendered.has(p.id)) rendered.set(p.id, { ...t });
      if (p.id === me?.id) localTarget = t;
    }
  }

  function attach() {
    if (socket && !socket.__roamersSmoothFix) {
      socket.__roamersSmoothFix = true;
      socket.on('player:positionUpdate', remember);
    }
  }

  // Wake the Render service while the lobby page is loading, so Create/Join does not
  // pay the cold-start cost a second time.
  try { if (typeof connect === 'function') connect(); } catch (_) {}
  setInterval(attach, 250);
  attach();

  function inputVector() {
    const x = joyVector.x + (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    const y = joyVector.y + (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
    const l = Math.hypot(x, y);
    return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }

  function tick(now) {
    const dt = Math.min(.05, Math.max(.001, (now - last) / 1000));
    last = now;
    const follow = 1 - Math.exp(-dt * 20);

    for (const [id, target] of targets) {
      const r = rendered.get(id) || { ...target };
      r.x += (target.x - r.x) * follow;
      r.y += (target.y - r.y) * follow;
      rendered.set(id, r);
      const p = positions.get(id);
      if (p) { p.x = r.x; p.y = r.y; }
    }

    if (me && !soloMode && phase !== 'lobby' && phase !== 'results') {
      const v = inputVector();
      if (v.x || v.y) {
        const speed = WORLD.w * .24;
        localPos.x = clamp(localPos.x + v.x * speed * dt / WORLD.w, .03, .97);
        localPos.y = clamp(localPos.y + v.y * speed * dt / WORLD.h, .06, .94);
      }
      if (localTarget) {
        const correction = 1 - Math.exp(-dt * 7);
        localPos.x += (localTarget.x - localPos.x) * correction;
        localPos.y += (localTarget.y - localPos.y) * correction;
      }
      const meRender = rendered.get(me.id);
      if (meRender) { meRender.x = localPos.x; meRender.y = localPos.y; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function updateAim(e) {
    if (role !== 'HUNTER' || phase !== 'hunting') return;
    const r = canvas.getBoundingClientRect(), c = camera();
    const wx = (e.clientX - r.left) / c.scale + c.x;
    const wy = (e.clientY - r.top) / c.scale + c.y;
    const mp = worldPoint(localPos), dx = wx - mp.x, dy = wy - mp.y, len = Math.hypot(dx, dy);
    if (len > 1) { aim.x = dx / len; aim.y = dy / len; }
  }
  canvas.addEventListener('pointerdown', e => {
    if (role === 'HUNTER') { canvas.setPointerCapture?.(e.pointerId); updateAim(e); }
  }, { passive: true });
  canvas.addEventListener('pointermove', updateAim, { passive: true });
})();
