'use strict';
// Visuals and a private, device-local focus session. No database changes.
(() => {
  const el = id => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (matchMedia('(hover:hover) and (pointer:fine)').matches && !reduced.matches) {
    let frame = 0, x = 0, y = 0;
    document.addEventListener('pointermove', event => {
      x = event.clientX; y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        el('cursorGlow').style.transform = `translate(${x - 200}px,${y - 200}px)`;
        el('cursorGlow').style.opacity = '1'; frame = 0;
      });
    }, {passive:true});
    document.documentElement.addEventListener('pointerleave', () => el('cursorGlow').style.opacity = '0');
  }
  function greet() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = el('userName').textContent.trim();
    el('personalGreeting').textContent = `${greeting}${name ? ', ' + name : ''}. Your seat is ready.`;
  }
  new MutationObserver(greet).observe(el('app'), {attributes:true, attributeFilter:['hidden']});
  greet();
  const duration = 25 * 60, key = 'prsn-focus-v1';
  let remaining = duration, end = null, finished = false;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= duration) {
      remaining = saved.remaining;
      if (Number.isFinite(saved.end) && saved.end > 0 && saved.end <= Date.now() + duration * 1000) end = saved.end;
      finished = saved.finished === true;
    }
  } catch {}
  function save() {
    try { localStorage.setItem(key, JSON.stringify({remaining,end,finished})); } catch {}
  }
  function paint() {
    el('focusTime').textContent = `${String(Math.floor(remaining / 60)).padStart(2,'0')}:${String(remaining % 60).padStart(2,'0')}`;
    el('focusRing').style.strokeDashoffset = String(333.01 * (1 - remaining / duration));
    el('focusStart').textContent = end ? 'Pause focus Ⅱ' : finished ? 'Another sprint ↗' : remaining < duration ? 'Resume focus ↗' : 'Start focus ↗';
    const state = finished ? 'Done. Take a little break.' : end ? 'Just you and one chapter' : remaining < duration ? 'Paused. Take your time.' : 'Ready when you are';
    // Announce state changes, not a countdown every second.
    if (el('focusState').textContent !== state) el('focusState').textContent = state;
    el('focusHeading').closest('section').classList.toggle('complete', finished);
  }
  function tick() {
    if (end) {
      remaining = Math.min(duration, Math.max(0, Math.ceil((end - Date.now()) / 1000)));
      if (remaining === 0) { end = null; finished = true; save(); }
    }
    paint();
  }
  el('focusStart').addEventListener('click', () => {
    tick();
    if (end) end = null;
    else { if (finished || remaining === 0) remaining = duration; finished = false; end = Date.now() + remaining * 1000; }
    save(); paint();
  });
  el('focusReset').addEventListener('click', () => { end = null; remaining = duration; finished = false; save(); paint(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) {tick();greet();} });
  setInterval(() => { if (!document.hidden) tick(); }, 1000);
  tick();
})();
