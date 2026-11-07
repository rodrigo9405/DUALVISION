// DualVision dentro de Netflix, Disney+, Prime Video, HBO Max, Crunchyroll y YouTube.
// Escucha play, pausa y adelantar del video y los aplica a los demás de la sala.
(() => {
  if (window.__dualvisionPlayer) return;
  window.__dualvisionPlayer = true;

  const host = location.hostname;
  const SERVICE =
    /(^|\.)netflix\./.test(host) ? 'netflix' :
    /(^|\.)disneyplus\./.test(host) ? 'disney' :
    /(^|\.)(primevideo|amazon)\./.test(host) ? 'prime' :
    /(^|\.)(max|hbomax)\.com$/.test(host) ? 'hbomax' :
    /(^|\.)crunchyroll\./.test(host) ? 'crunchyroll' :
    /(^|\.)youtube\./.test(host) ? 'youtube' : 'other';
  const NAMES = { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', crunchyroll: 'Crunchyroll', youtube: 'YouTube', other: 'el video' };
  const TOP = window.top === window;

  const S = {
    port: null, dead: false, video: null, room: null, online: false, members: [],
    quietUntil: 0, controller: null, pending: null, lastSent: null, countTimer: null
  };

  let ui = null;
  let lastOffer = 0;

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }

  /* ---------- Conexión con la extensión ---------- */

  function connect() {
    if (S.dead) return;
    try {
      S.port = chrome.runtime.connect({ name: 'player' });
    } catch {
      S.dead = true; // la extensión se actualizó o se quitó
      return;
    }
    S.port.onMessage.addListener(onMessage);
    S.port.onDisconnect.addListener(() => {
      S.port = null;
      setTimeout(connect, 1000);
    });
    S.port.postMessage({ type: 'hello' });
  }

  function post(msg) {
    if (!S.port) return;
    try { S.port.postMessage(msg); } catch { S.port = null; }
  }

  /* ---------- Encontrar el video principal ---------- */

  function pickVideo() {
    if (SERVICE === 'netflix' && !/^\/watch\//.test(location.pathname)) return null;
    let best = null, bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 120 * 90) continue;
      if (Number.isFinite(v.duration) && v.duration > 0 && v.duration < 30) continue;
      if (area > bestArea) { best = v; bestArea = area; }
    }
    return best;
  }

  const LOCAL_EVENTS = ['play', 'pause', 'seeked'];
  function attach(v) {
    S.video = v;
    for (const e of LOCAL_EVENTS) v.addEventListener(e, onLocal);
    if (!S.port) connect(); else post({ type: 'hello' });
    render();
  }
  function detach() {
    if (!S.video) return;
    for (const e of LOCAL_EVENTS) S.video.removeEventListener(e, onLocal);
    S.video = null;
    render();
  }
  function scan() {
    const v = pickVideo();
    if (v !== S.video) { detach(); if (v) attach(v); }
  }
  setInterval(scan, 1000);
  scan();

  function contentKey() {
    if (!TOP) return null;
    if (SERVICE === 'youtube') return new URLSearchParams(location.search).get('v');
    if (SERVICE === 'netflix') return (location.pathname.match(/\/watch\/(\d+)/) || [])[1] || null;
    const parts = location.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }
  function shareUrl() {
    if (!TOP) return null;
    if (SERVICE === 'youtube') return `${location.origin}/watch?v=${new URLSearchParams(location.search).get('v')}`;
    return location.origin + location.pathname;
  }
  function title() {
    if (!TOP || SERVICE === 'netflix') return null;
    return document.title.replace(/\s*[-|]\s*(YouTube|Disney\+|Prime Video|HBO Max|Max|Crunchyroll)\s*$/i, '').slice(0, 80) || null;
  }
  function ctx() {
    return { service: SERVICE, key: contentKey(), url: shareUrl(), title: title() };
  }

  /* ---------- Cambios hechos aquí ---------- */

  function onLocal() {
    if (Date.now() < S.quietUntil) return;
    clearTimeout(S.pending);
    S.pending = setTimeout(() => {
      const v = S.video;
      if (!v || !S.room || !S.online || Date.now() < S.quietUntil) return;
      const msg = { action: v.paused ? 'pause' : 'play', t: v.currentTime, ...ctx() };
      const last = S.lastSent;
      if (last && last.action === msg.action && Date.now() - last.at < 1500 && Math.abs(last.t - msg.t) < 1.5) return;
      S.lastSent = { ...msg, at: Date.now() };
      S.controller = 'me';
      post({ type: 'cmd', data: msg });
    }, 300);
  }

  setInterval(() => {
    const v = S.video;
    if (!v || !S.room || !S.online) return;
    post({ type: 'state', data: { t: v.currentTime, playing: !v.paused, ...ctx() } });
  }, 3000);

  /* ---------- Controlar el video ---------- */

  function quiet(ms = 1400) { S.quietUntil = Date.now() + ms; }

  function seek(t) {
    if (!S.video) return;
    if (SERVICE === 'netflix') window.postMessage({ __dvnf: 'seek', ms: t * 1000 }, '*');
    else S.video.currentTime = t;
  }
  function doPlay() {
    if (!S.video) return;
    if (SERVICE === 'netflix') { window.postMessage({ __dvnf: 'play' }, '*'); return; }
    const p = S.video.play();
    if (p && p.catch) p.catch(() => toast('El navegador no dejó darle play solo. Toca play.'));
  }
  function doPause() {
    if (!S.video) return;
    if (SERVICE === 'netflix') window.postMessage({ __dvnf: 'pause' }, '*');
    else S.video.pause();
  }

  /* ---------- Cambios de los demás ---------- */

  function onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'status') {
      S.room = msg.room; S.online = msg.online; S.members = msg.members || [];
      render();
    } else if (msg.type === 'remote') {
      onRemote(msg.ev, msg.payload || {}, msg);
    }
  }

  function sameContent(p) {
    if (!TOP || !p.key) return true;
    const mine = contentKey();
    return !mine || mine === p.key;
  }

  function onRemote(ev, p, meta) {
    if (!S.video) return;
    if (ev === 'pauseall') {
      quiet(); doPause();
      toast(`${p.name || 'Alguien'} pidió pausa`);
      return;
    }
    if (ev === 'count') { startCount(p); return; }
    if (p.service && p.service !== SERVICE) return;
    if (!sameContent(p)) {
      if (ev === 'xcmd' || meta.catchUp) offerSame(p);
      return;
    }
    if (ev === 'xcmd') applyCmd(p);
    else if (ev === 'xstate') applyState(p, meta);
  }

  function applyCmd(p) {
    S.controller = p.from;
    const lag = p.action === 'play' ? clamp((Date.now() - (p.sentAt || Date.now())) / 1000, 0, 2) : 0;
    const target = (p.t || 0) + lag;
    quiet();
    if (Math.abs(S.video.currentTime - target) > 1) seek(target);
    if (p.action === 'play') doPlay(); else doPause();
    toast(`${p.name || 'Alguien'} ${p.action === 'play' ? 'le dio play' : 'pausó'} en ${fmt(target)}`);
  }

  function applyState(p, meta) {
    const v = S.video;
    if (meta.catchUp) {
      const target = (p.t || 0) + (p.playing ? (Date.now() - meta.receivedAt) / 1000 : 0);
      S.controller = p.from;
      quiet();
      seek(target);
      if (p.playing) doPlay(); else doPause();
      toast(`Te sincronizaste con ${p.name || 'la sala'} en ${fmt(target)}`);
      return;
    }
    if (S.controller === 'me') return;
    if (S.controller && p.from !== S.controller) return;
    if (!p.playing || v.paused) return;
    const target = (p.t || 0) + clamp((Date.now() - (p.sentAt || Date.now())) / 1000, 0, 2);
    if (Math.abs(v.currentTime - target) > 2.5) { quiet(); seek(target); }
  }

  function startCount(p) {
    let at = Number(p.at);
    const now = Date.now();
    if (!at || at - now > 8000 || at - now < -1500) at = now + 3500;
    clearInterval(S.countTimer);
    const tick = () => {
      const rem = at - Date.now();
      if (rem > 0) {
        setCount(rem > 3000 ? 'Listos' : String(Math.ceil(rem / 1000)), `${p.name || 'Alguien'} inició la cuenta`);
        return;
      }
      clearInterval(S.countTimer);
      setCount('Play', '');
      setTimeout(() => setCount(null), 1200);
      quiet();
      if (typeof p.t === 'number') seek(p.t);
      doPlay();
    };
    tick();
    S.countTimer = setInterval(tick, 100);
  }

  /* ---------- Interfaz dentro de la plataforma ---------- */

  function buildUi() {
    const host = document.createElement('div');
    host.id = 'dualvision-ext';
    host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { font: 500 14px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #f4f2ff; display: grid; gap: 8px; justify-items: start; }
        .pill { display: flex; align-items: center; gap: 10px; padding: 7px 12px 7px 9px; border-radius: 99px;
          background: rgba(21,18,58,.88); border: 1px solid #3a3480; box-shadow: 0 6px 20px rgba(0,0,0,.35);
          opacity: .45; transition: opacity .25s; }
        .wrap:hover .pill, .pill.awake { opacity: 1; }
        .mark { position: relative; width: 26px; height: 16px; flex: none; }
        .mark i { position: absolute; top: 0; width: 16px; height: 16px; border-radius: 50%; mix-blend-mode: screen; }
        .mark i:first-child { left: 0; background: #ffb547; } .mark i:last-child { right: 0; background: #46d9e6; }
        .code { font: 800 15px/1 'Arial Narrow', sans-serif; letter-spacing: .14em; color: #ffb547; }
        .who { color: #aaa5d8; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #ff6b7f; }
        .dot.on { background: #b6f36b; }
        .toast { max-width: 340px; padding: 9px 12px; border-radius: 8px; background: #2a2563; border: 1px solid #3a3480; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
        .offer { display: flex; gap: 10px; align-items: center; }
        .offer a { color: #15123a; background: #ffb547; padding: 6px 10px; border-radius: 6px; text-decoration: none; font-weight: 600; white-space: nowrap; }
        .count { display: grid; justify-items: start; padding: 8px 16px 10px; border-radius: 12px; background: rgba(21,18,58,.92); border: 1px solid #3a3480; }
        .count b { font: 900 64px/1 'Arial Narrow', sans-serif; color: #46d9e6; }
        .count span { color: #aaa5d8; font-size: 13px; }
      </style>
      <div class="wrap">
        <div class="stack"></div>
        <div class="count" hidden><span class="count-by"></span><b class="count-num"></b></div>
        <div class="pill" title="DualVision">
          <span class="mark"><i></i><i></i></span>
          <span class="code"></span>
          <span class="who"></span>
          <span class="dot"></span>
        </div>
      </div>`;
    ui = {
      host, root,
      stack: root.querySelector('.stack'), pill: root.querySelector('.pill'),
      code: root.querySelector('.code'), who: root.querySelector('.who'), dot: root.querySelector('.dot'),
      count: root.querySelector('.count'), countNum: root.querySelector('.count-num'), countBy: root.querySelector('.count-by')
    };
    placeUi();
  }

  function placeUi() {
    if (!ui) return;
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (ui.host.parentNode !== parent) parent.append(ui.host);
  }
  document.addEventListener('fullscreenchange', placeUi);

  function render() {
    const show = !!(S.video && S.room);
    if (!show) { if (ui) ui.host.remove(); return; }
    if (!ui) buildUi();
    placeUi();
    const people = S.members.filter((m) => m.kind === 'web' || m.kind === 'ext');
    const names = new Set(people.map((m) => m.owner || m.id));
    ui.code.textContent = S.room.code;
    ui.who.textContent = S.online ? `${names.size} en la sala` : 'Reconectando…';
    ui.dot.classList.toggle('on', S.online);
  }

  function wake() {
    if (!ui) return;
    ui.pill.classList.add('awake');
    clearTimeout(wake.t);
    wake.t = setTimeout(() => ui && ui.pill.classList.remove('awake'), 4000);
  }

  function toast(text, extra) {
    if (!S.room || !S.video) return;
    if (!ui) buildUi();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    if (extra) { el.classList.add('offer'); el.append(extra); }
    ui.stack.append(el);
    while (ui.stack.children.length > 3) ui.stack.firstChild.remove();
    setTimeout(() => el.remove(), extra ? 12000 : 4000);
    wake();
  }

  function offerSame(p) {
    if (!p.url || Date.now() - lastOffer < 15000) return;
    lastOffer = Date.now();
    const a = document.createElement('a');
    a.href = p.url;
    a.textContent = 'Ir al mismo';
    toast(`${p.name || 'Alguien'} está viendo ${p.title ? `«${p.title}»` : 'otro título'} en ${NAMES[SERVICE]}.`, a);
  }

  function setCount(num, by) {
    if (!S.room || !S.video) return;
    if (!ui) buildUi();
    if (num == null) { ui.count.hidden = true; return; }
    ui.count.hidden = false;
    ui.countNum.textContent = num;
    ui.countBy.textContent = by;
    wake();
  }
})();
