import { Room } from './room.js';
import { Mesh } from './rtc.js';
import { YouTubeSync, parseYouTubeId } from './youtube.js';

const cfg = window.DV_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

function icon(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'ic');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const myId = Math.random().toString(36).slice(2, 10);
const rid = () => Math.random().toString(36).slice(2, 12);

const SERVICES = {
  youtube: { name: 'YouTube', url: 'https://www.youtube.com/' },
  netflix: { name: 'Netflix', url: 'https://www.netflix.com/browse' },
  disney: { name: 'Disney+', url: 'https://www.disneyplus.com/' },
  prime: { name: 'Prime Video', url: 'https://www.primevideo.com/' },
  hbomax: { name: 'HBO Max', url: 'https://play.hbomax.com/' },
  crunchyroll: { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/' },
  other: { name: 'Otra plataforma', url: null }
};
const OTHER_COLORS = ['them', 'rose', 'lime'];

const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { heartbeatIntervalMs: 20000 }
});

// Referencias fijas: el panel lateral puede mudarse a la ventana flotante.
const E = {
  home: $('#home'), room: $('#room'),
  form: $('#home-form'), name: $('#name'), code: $('#code'), create: $('#create'), join: $('#join'),
  invite: $('#invite'), homeError: $('#home-error'),
  codeTiles: $('#code-tiles'), share: $('#share'), net: $('#net'), people: $('#people'), leave: $('#leave'),
  stage: $('#stage'), picker: $('#picker'), yt: $('#yt'), ytForm: $('#yt-form'), ytUrl: $('#yt-url'),
  ytMount: $('#yt-mount'), ytEmpty: $('#yt-empty'), tapSync: $('#tap-sync'),
  stream: $('#stream'), streamName: $('#stream-name'), streamLede: $('#stream-lede'), streamOpen: $('#stream-open'),
  streamExt: $('#stream-ext'), streamLive: $('#stream-live'), streamTip: $('#stream-tip'),
  syncTime: $('#sync-time'), syncCount: $('#sync-count'), syncPause: $('#sync-pause'),
  reactions: $('#reactions'),
  countdown: $('#countdown'), countBy: $('#count-by'), countNum: $('#count-num'), countLabel: $('#count-label'),
  pauseOv: $('#pause-ov'), pauseText: $('#pause-text'),
  mic: $('#btn-mic'), cam: $('#btn-cam'), float: $('#btn-float'), change: $('#btn-change'),
  side: $('#side'), tiles: $('#tiles'), messages: $('#messages'), chatForm: $('#chat-form'), chatInput: $('#chat-input'),
  toasts: $('#toasts')
};

const S = {
  me: { id: myId, name: '', kind: 'web', device: isMobile ? 'mobile' : 'pc', cam: false, mic: false, joinedAt: 0 },
  code: null, room: null, mesh: null, yt: null,
  peers: [], exts: [], names: new Map(),
  stage: { mode: 'pick', v: 0 }, picking: false, gotState: false, presenceSeen: false,
  chat: [], xstate: new Map(), lastYt: null,
  local: { audio: null, video: null }, localStream: null,
  streams: new Map(), conn: new Map(), tiles: new Map(),
  hasExt: !!document.documentElement.dataset.dvExt,
  pip: null, countTimer: null, liveTimer: null, lastReact: 0
};

/* ---------------- Utilidades ---------------- */

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h_ = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h_ ? `${h_}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function parseTime(str) {
  let s = String(str || '').trim();
  if (!s) return null;
  // En el celular el teclado numérico no tiene ":", así que 1234 significa 12:34.
  if (/^\d{3,6}$/.test(s)) s = formatDigits(s);
  if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(s)) return NaN;
  return s.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
}

function formatDigits(digits) {
  const d = digits.replace(/\D/g, '').replace(/^0+(?=\d{3})/, '').slice(-6);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, -2)}:${d.slice(-2)}`;
  return `${d.slice(0, -4)}:${d.slice(-4, -2)}:${d.slice(-2)}`;
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

function colorOf(id) {
  if (id === myId) return 'you';
  const i = S.peers.findIndex((p) => p.id === id);
  return OTHER_COLORS[(i >= 0 ? i : 0) % OTHER_COLORS.length];
}

function nameOf(id) {
  if (id === myId) return S.me.name;
  return S.names.get(id) || 'Alguien';
}

function vibrate(ms) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch {}
}

let lastToast = { text: '', at: 0 };
function toast(text, action, ms = 4200) {
  if (!action && text === lastToast.text && Date.now() - lastToast.at < 2500) return;
  lastToast = { text, at: Date.now() };
  const t = h('div', { class: 'toast' }, h('span', { text }));
  if (action) {
    t.append(h('button', { type: 'button', text: action.label, onclick: () => { action.run(); t.remove(); } }));
    ms = Math.max(ms, 9000);
  }
  E.toasts.append(t);
  while (E.toasts.children.length > (isMobile ? 2 : 3)) E.toasts.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}

function playMedia(video) {
  const p = video.play();
  if (p && p.catch) p.catch((err) => {
    if (err && err.name === 'NotAllowedError') askSoundUnlock();
  });
}

let soundAsked = false;
function askSoundUnlock() {
  if (soundAsked) return;
  soundAsked = true;
  toast('Tu navegador bloqueó el sonido de la sala.', {
    label: 'Activar sonido',
    run: () => { soundAsked = false; for (const t of S.tiles.values()) t.video.play().catch(() => {}); }
  });
}

/* ---------------- Inicio ---------------- */

const params = new URLSearchParams(location.search);
const invited = (params.get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
E.name.value = store.get('dv-name') || '';
$('#ext-download-home').href = cfg.extensionZip;
if (invited.length === 6) {
  E.code.value = invited;
  E.invite.hidden = false;
  E.invite.replaceChildren('Te invitaron a la sala ', h('strong', { text: invited }), '. Escribe tu nombre y toca Entrar.');
  E.join.classList.add('primary');
  E.create.classList.remove('primary');
}

function homeError(text, focus) {
  E.homeError.textContent = text || '';
  if (focus) focus.focus();
}

function readName() {
  const name = E.name.value.trim().replace(/\s+/g, ' ');
  if (!name) { homeError('Escribe tu nombre para que te reconozcan en la sala.', E.name); return null; }
  store.set('dv-name', name);
  return name;
}

function setBusy(busy) {
  E.create.disabled = busy;
  E.join.disabled = busy;
}

E.create.addEventListener('click', async () => {
  const name = readName();
  if (!name) return;
  homeError('');
  setBusy(true);
  try {
    const { data, error } = await sb.rpc('crear_sala');
    if (error || !data) throw error || new Error('sin código');
    await enterRoom(String(data), name);
  } catch (err) {
    console.warn(err);
    homeError('No hay conexión con DualVision. Revisa tu internet e inténtalo otra vez.');
  } finally {
    setBusy(false);
  }
});

E.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = readName();
  if (!name) return;
  const code = E.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { homeError('El código tiene 6 letras y números, por ejemplo K7MP2Q.', E.code); return; }
  homeError('');
  setBusy(true);
  try {
    const { data, error } = await sb.rpc('entrar_sala', { p_codigo: code });
    if (error) throw error;
    if (!data) { homeError(`No existe una sala con el código ${code}. Revisa las letras o pide el enlace de nuevo.`, E.code); return; }
    await enterRoom(code, name);
  } catch (err) {
    console.warn(err);
    homeError('No hay conexión con DualVision. Revisa tu internet e inténtalo otra vez.');
  } finally {
    setBusy(false);
  }
});

E.code.addEventListener('input', () => {
  const pos = E.code.selectionStart;
  E.code.value = E.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  try { E.code.setSelectionRange(pos, pos); } catch {}
});

/* ---------------- Entrar y salir ---------------- */

async function enterRoom(code, name) {
  S.code = code;
  S.me.name = name;
  S.me.joinedAt = Date.now();
  S.names.set(myId, name);
  history.replaceState(null, '', `${location.pathname}?sala=${code}`);
  document.title = `Sala ${code} · DualVision`;

  E.home.hidden = true;
  E.room.hidden = false;
  E.codeTiles.replaceChildren(...code.split('').map((c) => h('span', { text: c })));
  E.codeTiles.setAttribute('aria-label', `Código de sala ${code.split('').join(' ')}. Toca para copiar.`);
  setOnline(false);
  renderStage();
  renderTiles();
  renderPeople();

  const room = new Room(sb, code, S.me);
  S.room = room;
  S.mesh = new Mesh({
    myId,
    iceServers: cfg.iceServers,
    send: (m) => room.send('signal', m),
    onStream: (id, stream) => {
      if (stream) S.streams.set(id, stream); else S.streams.delete(id);
      renderTiles();
    },
    onState: (id, state) => { S.conn.set(id, state); renderTiles(); }
  });

  room.on('status', (s) => setOnline(s === 'online'));
  room.on('presence', onPresence);
  room.on('hello', (m) => {
    room.send('state', {
      to: m.from,
      stage: S.stage,
      yt: S.yt ? S.yt.snapshot() : null,
      chat: S.chat.filter((c) => !c.system).slice(-50)
    });
  });
  room.on('state', (m) => {
    if (m.to !== myId || S.gotState) return;
    S.gotState = true;
    if (Array.isArray(m.chat)) mergeChat(m.chat);
    if (m.stage && m.stage.v > S.stage.v) applyStage(m.stage, m.yt);
  });
  room.on('stage', (m) => {
    if (m.stage && m.stage.v > S.stage.v) {
      applyStage(m.stage);
      const svc = SERVICES[m.stage.service];
      if (m.stage.mode !== 'pick') toast(`${nameOf(m.from)} eligió ${m.stage.mode === 'youtube' ? 'YouTube' : (svc ? svc.name : 'qué ver')}`);
    }
  });
  room.on('chat', (m) => addChat(m));
  room.on('react', (m) => floatEmoji(m.emoji, m.from));
  room.on('yt', (m) => {
    S.lastYt = { ...m, receivedAt: Date.now() };
    if (S.stage.mode === 'youtube' && S.yt) S.yt.apply(m);
    if (m.action === 'play' || m.action === 'pause') {
      toast(`${nameOf(m.from)} ${m.action === 'play' ? 'le dio play' : 'pausó'} en ${fmt(m.t)}`, null, 2500);
    }
  });
  room.on('signal', (m) => S.mesh && S.mesh.onSignal(m));
  room.on('count', (m) => startCountdown(m));
  room.on('pauseall', (m) => showPauseAll(m));
  room.on('xstate', (m) => { S.xstate.set(m.from, { ...m, at: Date.now() }); renderLive(); });
  room.on('xcmd', (m) => {
    S.xstate.set(m.from, { ...m, playing: m.action === 'play', at: Date.now() });
    renderLive();
    const svc = SERVICES[m.service];
    toast(`${m.name || 'Alguien'} ${m.action === 'play' ? 'le dio play' : 'pausó'} ${svc ? svc.name : ''} en ${fmt(m.t)}`.replace('  ', ' '), null, 3500);
    if (isMobile) vibrate(120);
  });

  try {
    await room.connect();
  } catch (err) {
    console.warn(err);
    toast('No se pudo entrar a la sala. Revisa tu conexión e inténtalo otra vez.');
    await leaveRoom();
    return;
  }
  room.send('hello', {});
  setTimeout(() => { S.gotState = true; }, 3000);
  tellExtension();
  addSystem(`Estás en la sala ${code}. Toca Invitar para pasarle el enlace a la otra persona.`);
}

async function leaveRoom() {
  if (S.pip) { try { S.pip.close(); } catch {} }
  window.postMessage({ __dualvision: 'leave' }, '*');
  if (S.yt) { S.yt.destroy(); S.yt = null; }
  if (S.mesh) { S.mesh.closeAll(); S.mesh = null; }
  for (const k of ['audio', 'video']) {
    if (S.local[k]) { S.local[k].stop(); S.local[k] = null; }
  }
  S.localStream = null;
  const room = S.room;
  S.room = null;
  if (room) await room.leave();

  Object.assign(S.me, { cam: false, mic: false });
  Object.assign(S, {
    code: null, peers: [], exts: [], stage: { mode: 'pick', v: 0 }, picking: false,
    gotState: false, presenceSeen: false, chat: [], lastYt: null
  });
  S.xstate.clear(); S.streams.clear(); S.conn.clear();
  for (const t of S.tiles.values()) t.el.remove();
  S.tiles.clear();
  E.messages.replaceChildren();
  E.people.replaceChildren();
  E.countdown.hidden = true;
  E.pauseOv.hidden = true;
  clearInterval(S.countTimer);
  updateControls();

  history.replaceState(null, '', location.pathname);
  document.title = 'DualVision';
  E.room.hidden = true;
  E.home.hidden = false;
  E.invite.hidden = true;
  E.join.classList.remove('primary');
  E.create.classList.add('primary');
}

E.leave.addEventListener('click', () => leaveRoom());
window.addEventListener('pagehide', () => { if (S.room) S.room.leave(); });

function setOnline(online) {
  E.net.dataset.online = String(online);
  E.net.textContent = online ? 'Conectado' : 'Reconectando…';
}

/* ---------------- Personas y cámaras ---------------- */

function onPresence(members) {
  const web = members.filter((m) => m.kind === 'web').sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const myIndex = web.findIndex((m) => m.id === myId);
  if (myIndex >= cfg.maxPeople) {
    toast(`La sala está llena: entran hasta ${cfg.maxPeople} personas.`);
    leaveRoom();
    return;
  }
  const before = new Map(S.peers.map((p) => [p.id, p]));
  S.peers = web.filter((m) => m.id !== myId).slice(0, cfg.maxPeople - 1);
  S.exts = members.filter((m) => m.kind === 'ext');
  for (const p of S.peers) S.names.set(p.id, p.name);

  if (S.presenceSeen) {
    for (const p of S.peers) if (!before.has(p.id)) addSystem(`${p.name} entró a la sala`);
    for (const [id, p] of before) if (!S.peers.find((x) => x.id === id)) addSystem(`${p.name} salió de la sala`);
  }
  S.presenceSeen = true;
  if (S.mesh) S.mesh.sync(S.peers.map((p) => p.id));
  renderPeople();
  renderTiles();
  if (!E.stream.hidden) renderStream();
}

function hasExtension(ownerId) {
  return S.exts.some((x) => x.owner === ownerId);
}

function renderPeople() {
  const list = [S.me, ...S.peers];
  E.people.replaceChildren(...list.map((p) => {
    const el = h('span', {
      class: 'person', 'data-color': colorOf(p.id),
      title: p.id === myId ? `${p.name} (tú)` : p.name
    }, initials(p.name));
    if (hasExtension(p.id)) el.append(h('span', { class: 'ext', text: 'PC', title: 'Extensión conectada' }));
    return el;
  }));
  E.people.setAttribute('aria-label', `${list.length} ${list.length === 1 ? 'persona' : 'personas'} en la sala`);
}

function tileFor(id) {
  let t = S.tiles.get(id);
  if (t) return t;
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  if (id === myId) { video.muted = true; video.classList.add('mirror'); }
  const avatar = h('div', { class: 'avatar' });
  const label = h('span', { class: 'tile-name' });
  const micOff = h('span', { class: 'tile-mic', title: 'Micrófono apagado' }, icon('i-mic-off'));
  const note = h('span', { class: 'tile-note' });
  const el = h('figure', { class: 'tile' }, video, avatar, h('figcaption', {}, label, micOff), note);
  t = { el, video, avatar, label, micOff, note };
  S.tiles.set(id, t);
  return t;
}

function renderTiles() {
  const list = [S.me, ...S.peers];
  for (const [id, t] of S.tiles) {
    if (!list.find((p) => p.id === id)) { t.el.remove(); S.tiles.delete(id); }
  }
  list.forEach((p, i) => {
    const t = tileFor(p.id);
    const mine = p.id === myId;
    t.el.dataset.color = colorOf(p.id);
    t.label.textContent = mine ? `${p.name} (tú)` : p.name;
    t.avatar.textContent = initials(p.name);
    t.el.classList.toggle('cam-on', !!p.cam);
    t.micOff.hidden = !!p.mic;
    const stream = mine ? S.localStream : S.streams.get(p.id);
    if (stream && t.video.srcObject !== stream) { t.video.srcObject = stream; playMedia(t.video); }
    if (!stream && t.video.srcObject) t.video.srcObject = null;
    const st = S.conn.get(p.id);
    t.note.textContent = !mine && (p.cam || p.mic) && st !== 'connected'
      ? (st === 'failed' ? 'No se pudo conectar el video' : 'Conectando…') : '';
    if (E.tiles.children[i] !== t.el) E.tiles.insertBefore(t.el, E.tiles.children[i] || null);
  });
  E.tiles.dataset.count = String(list.length);
}

/* ---------------- Micrófono y cámara ---------------- */

function mediaError(err, what) {
  console.warn(err);
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast(`Este navegador no deja usar el ${what} aquí. Abre DualVision en Chrome o Safari.`);
  } else if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    toast(`El permiso del ${what} está bloqueado. Actívalo desde el candado junto a la dirección y vuelve a tocar el botón.`, null, 7000);
  } else if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
    toast(`No encontramos ningún ${what} en este dispositivo.`);
  } else if (err && err.name === 'NotReadableError') {
    toast(`Otra app está usando el ${what}. Ciérrala y vuelve a intentarlo.`);
  } else {
    toast(`No se pudo encender el ${what}.`);
  }
}

function setMe(patch) {
  Object.assign(S.me, patch);
  if (S.room) S.room.update(patch);
  updateControls();
  renderTiles();
}

function updateControls() {
  const set = (btn, on, onIcon, offIcon) => {
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('use').setAttribute('href', '#' + (on ? onIcon : offIcon));
  };
  set(E.mic, !!S.me.mic, 'i-mic', 'i-mic-off');
  set(E.cam, !!S.me.cam, 'i-cam', 'i-cam-off');
  E.mic.querySelector('span').textContent = S.me.mic ? 'Micrófono encendido' : 'Micrófono';
  E.cam.querySelector('span').textContent = S.me.cam ? 'Cámara encendida' : 'Cámara';
}

async function toggleMic() {
  if (S.local.audio) {
    S.local.audio.stop();
    S.local.audio = null;
    if (S.mesh) S.mesh.setTrack('audio', null);
    setMe({ mic: false });
    return;
  }
  try {
    const st = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    const track = st.getAudioTracks()[0];
    S.local.audio = track;
    track.addEventListener('ended', () => { if (S.local.audio === track) toggleMic(); });
    if (S.mesh) S.mesh.setTrack('audio', track);
    setMe({ mic: true });
  } catch (err) {
    mediaError(err, 'micrófono');
  }
}

async function toggleCam() {
  if (S.local.video) {
    S.local.video.stop();
    S.local.video = null;
    S.localStream = null;
    if (S.mesh) S.mesh.setTrack('video', null);
    setMe({ cam: false });
    return;
  }
  try {
    const st = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }
    });
    const track = st.getVideoTracks()[0];
    S.local.video = track;
    S.localStream = new MediaStream([track]);
    track.addEventListener('ended', () => { if (S.local.video === track) toggleCam(); });
    if (S.mesh) S.mesh.setTrack('video', track);
    setMe({ cam: true });
  } catch (err) {
    mediaError(err, 'cámara');
  }
}

E.mic.addEventListener('click', toggleMic);
E.cam.addEventListener('click', toggleCam);

/* ---------------- Chat y reacciones ---------------- */

function nearBottom() {
  const m = E.messages;
  return m.scrollHeight - m.scrollTop - m.clientHeight < 80;
}

function renderMsg(m) {
  const stick = nearBottom();
  const last = E.messages.lastElementChild;
  const color = m.system ? 'sys' : colorOf(m.from);
  if (!m.system && last && last.dataset.from === m.from && m.ts - Number(last.dataset.ts) < 120000) {
    last.append(h('p', { text: m.text }));
    last.dataset.ts = String(m.ts);
  } else {
    E.messages.append(h('li', {
      class: m.system ? 'msg sys' : 'msg', 'data-color': color, 'data-from': m.from || '', 'data-ts': String(m.ts)
    }, m.system ? null : h('span', { class: 'who', text: m.from === myId ? 'Tú' : (m.name || nameOf(m.from)) }),
    h('p', { text: m.text })));
  }
  if (stick || m.from === myId) E.messages.scrollTop = E.messages.scrollHeight;
}

function addChat(m) {
  if (!m || typeof m.text !== 'string' || !m.text.trim()) return;
  if (m.id && S.chat.some((x) => x.id === m.id)) return;
  const msg = { id: m.id || rid(), from: m.from, name: m.name, text: m.text.slice(0, 500), ts: m.ts || Date.now(), system: !!m.system };
  S.chat.push(msg);
  if (S.chat.length > 300) S.chat.shift();
  renderMsg(msg);
}

function addSystem(text) {
  addChat({ id: rid(), text, ts: Date.now(), system: true });
}

function mergeChat(list) {
  const known = new Set(S.chat.map((c) => c.id));
  const incoming = list.filter((c) => c && c.id && !known.has(c.id) && typeof c.text === 'string');
  if (!incoming.length) return;
  S.chat = [...incoming.map((c) => ({ ...c, system: false })), ...S.chat].sort((a, b) => a.ts - b.ts);
  E.messages.replaceChildren();
  for (const m of S.chat) renderMsg(m);
  E.messages.scrollTop = E.messages.scrollHeight;
}

E.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = E.chatInput.value.trim();
  if (!text || !S.room) return;
  const m = { id: rid(), from: myId, name: S.me.name, text: text.slice(0, 500), ts: Date.now() };
  addChat(m);
  S.room.send('chat', m);
  E.chatInput.value = '';
});

function floatEmoji(emoji, from) {
  if (!/^\p{Extended_Pictographic}/u.test(String(emoji || ''))) return;
  const el = h('span', { class: 'float-emoji', 'data-color': colorOf(from) },
    emoji, h('small', { text: from === myId ? 'Tú' : nameOf(from) }));
  el.style.left = `${8 + Math.random() * 80}%`;
  el.addEventListener('animationend', () => el.remove());
  E.reactions.append(el);
  setTimeout(() => el.remove(), 3000);
}

$$('.reacts button').forEach((b) => b.addEventListener('click', () => {
  if (!S.room || Date.now() - S.lastReact < 350) return;
  S.lastReact = Date.now();
  floatEmoji(b.dataset.emoji, myId);
  S.room.send('react', { emoji: b.dataset.emoji });
}));

/* ---------------- Qué ver ---------------- */

function setStage(next) {
  S.stage = { ...next, v: Date.now(), by: myId };
  S.picking = false;
  if (S.room) S.room.send('stage', { stage: S.stage });
  renderStage();
}

function applyStage(stage, ytSnap) {
  S.stage = stage;
  S.picking = false;
  renderStage(ytSnap);
}

function renderStage(ytSnap) {
  const mode = S.picking ? 'pick' : S.stage.mode;
  E.picker.hidden = mode !== 'pick';
  E.yt.hidden = mode !== 'youtube';
  E.stream.hidden = mode !== 'stream';
  E.change.hidden = mode === 'pick';
  if (S.stage.mode !== 'youtube' && S.yt) { S.yt.destroy(); S.yt = null; }
  if (mode === 'youtube') renderYouTube(ytSnap);
  if (mode === 'stream') renderStream();
  clearInterval(S.liveTimer);
  if (mode === 'stream') S.liveTimer = setInterval(renderLive, 1000);
  tellExtension();
}

$$('.services button').forEach((b) => b.addEventListener('click', () => {
  const service = b.dataset.service;
  if (service === 'youtube') {
    if (S.stage.mode === 'youtube') { S.picking = false; renderStage(); return; }
    setStage({ mode: 'youtube', videoId: null });
    E.ytUrl.focus();
  } else {
    setStage({ mode: 'stream', service });
  }
}));

E.change.addEventListener('click', () => {
  S.picking = true;
  renderStage();
});

/* YouTube */

function ytError(code) {
  const id = S.stage.videoId;
  if (code === 101 || code === 150) {
    toast('Quien subió este video no deja verlo fuera de YouTube.', {
      label: 'Verlo en YouTube',
      run: () => setStage({ mode: 'stream', service: 'youtube', url: `https://www.youtube.com/watch?v=${id}` })
    });
  } else if (code === 100) {
    toast('Ese video fue eliminado o es privado.');
  } else if (code === 2) {
    toast('El enlace está incompleto. Cópialo de nuevo desde Compartir en YouTube.');
  } else {
    toast('YouTube no pudo reproducir este video aquí.');
  }
}

function renderYouTube(snap) {
  const id = S.stage.videoId;
  E.ytEmpty.hidden = !!id;
  if (!id) return;
  if (!S.yt) {
    S.yt = new YouTubeSync({
      mount: E.ytMount,
      send: (m) => S.room && S.room.send('yt', m),
      onBlocked: () => { E.tapSync.hidden = false; },
      onError: ytError
    });
  }
  if (S.yt.videoId !== id) {
    let opts = {};
    if (snap && snap.videoId === id) {
      const lag = snap.playing && snap.sentAt ? Math.min(Math.max((Date.now() - snap.sentAt) / 1000, 0), 3) : 0;
      opts = { t: (snap.t || 0) + lag, playing: !!snap.playing };
      S.lastYt = { action: snap.playing ? 'play' : 'pause', t: snap.t, sentAt: snap.sentAt, receivedAt: Date.now() };
    }
    S.yt.load(id, opts).catch(() => toast('No se pudo cargar YouTube. Revisa tu conexión.'));
  }
}

E.ytForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = parseYouTubeId(E.ytUrl.value);
  if (!id) { toast('Ese enlace no es de un video de YouTube. Cópialo desde el botón Compartir del video.'); return; }
  E.ytUrl.value = '';
  setStage({ mode: 'youtube', videoId: id });
});

E.tapSync.addEventListener('click', () => {
  E.tapSync.hidden = true;
  const last = S.lastYt;
  let target;
  if (last && (last.action === 'play' || last.action === 'tick')) {
    target = (last.t || 0) + (Date.now() - (last.receivedAt || Date.now())) / 1000;
  }
  if (S.yt) S.yt.resumeFromTap(target);
});

/* Plataformas con cuenta propia */

function renderStream() {
  const key = S.stage.service || 'other';
  const svc = SERVICES[key] || SERVICES.other;
  E.streamName.textContent = svc.name;
  E.streamLede.textContent = key === 'other'
    ? 'Cada uno abre la plataforma en su dispositivo, con su cuenta, y elige el mismo título.'
    : 'Cada uno entra con su propia cuenta y elige el mismo título.';
  const url = S.stage.url || svc.url;
  E.streamOpen.hidden = !url;
  if (url) {
    E.streamOpen.href = url;
    E.streamOpen.textContent = `Abrir ${svc.name}`;
  }

  const zip = cfg.extensionZip;
  if (key === 'other') {
    E.streamExt.replaceChildren();
  } else if (isMobile) {
    E.streamExt.replaceChildren(h('p', { text: `Abre ${svc.name} en tu celular con tu cuenta y busca el mismo título. Para empezar juntos, usen la cuenta regresiva de abajo.` }));
  } else if (S.hasExt) {
    E.streamExt.replaceChildren(
      h('p', { class: 'ok', text: 'La extensión DualVision está conectada a esta sala.' }),
      h('p', { text: `Abre ${svc.name}, elige el título y dale play. Play, pausa y adelantar se sincronizan solos con quienes tengan la extensión.` })
    );
  } else {
    E.streamExt.replaceChildren(
      h('p', { text: 'Para que play, pausa y adelantar se sincronicen solos en esta computadora, instala la extensión DualVision.' }),
      h('a', { class: 'btn', href: zip, download: true, text: 'Descargar extensión' }),
      h('details', {},
        h('summary', { text: 'Cómo instalarla' }),
        h('ol', {},
          h('li', { text: 'Descomprime el archivo descargado.' }),
          h('li', {}, 'Abre ', h('i', { text: 'chrome://extensions' }), ' y activa el Modo de desarrollador.'),
          h('li', { text: 'Toca Cargar descomprimida y elige la carpeta dualvision-extension.' }),
          h('li', { text: 'Recarga esta página.' })
        )
      )
    );
  }
  E.streamTip.textContent = isMobile
    ? `Consejo: prende tu cámara y toca Flotante para ver a la otra persona encima de ${svc.name}.`
    : `Consejo: toca Flotante para tener las cámaras y el chat encima de ${svc.name}, incluso en pantalla completa.`;
  renderLive();
}

function liveEntries() {
  const now = Date.now();
  const out = [];
  for (const [id, st] of S.xstate) {
    if (now - st.at > 20000) { S.xstate.delete(id); continue; }
    const t = (st.t || 0) + (st.playing ? (now - st.at) / 1000 : 0);
    const owner = S.exts.find((x) => x.id === id);
    const ownerId = owner ? owner.owner : null;
    out.push({ id, name: st.name || (owner && owner.name) || 'Alguien', t, playing: !!st.playing, service: st.service, title: st.title, color: ownerId ? colorOf(ownerId) : 'them' });
  }
  return out;
}

function renderLive() {
  if (E.stream.hidden) return;
  const entries = liveEntries();
  E.streamLive.replaceChildren(...entries.map((e) => h('li', { 'data-color': e.color },
    h('span', { class: 'dot' }),
    h('span', { class: 'who', text: e.name }),
    h('span', { class: 'pos', text: `${e.playing ? '▶' : 'Ⅱ'} ${fmt(e.t)}` }),
    h('span', { class: 'what', text: [SERVICES[e.service] ? SERVICES[e.service].name : '', e.title].filter(Boolean).join(': ') })
  )));
  const latest = entries.find((e) => e.playing) || entries[0];
  E.syncTime.placeholder = latest ? fmt(latest.t) : '12:34';
}

/* ---------------- Cuenta regresiva y pausa ---------------- */

E.syncCount.addEventListener('click', () => {
  if (!S.room) return;
  let t = parseTime(E.syncTime.value);
  if (Number.isNaN(t)) { toast('Escribe el minuto así: 12:34 o 1:02:03'); E.syncTime.focus(); return; }
  if (t == null) {
    const latest = liveEntries().find((e) => e.playing);
    if (latest) t = Math.round(latest.t) + 4;
  }
  const m = { at: Date.now() + 4000, t, name: S.me.name };
  S.room.send('count', m);
  startCountdown({ ...m, from: myId });
});

E.syncTime.addEventListener('input', () => {
  if (/^[\d:]*$/.test(E.syncTime.value)) E.syncTime.value = formatDigits(E.syncTime.value);
});

E.syncPause.addEventListener('click', () => {
  if (!S.room) return;
  S.room.send('pauseall', { name: S.me.name });
  toast('Pediste pausa a todos.');
});

function startCountdown(m) {
  let at = Number(m.at);
  const now = Date.now();
  if (!at || at - now > 8000 || at - now < -1500) at = now + 3500;
  E.pauseOv.hidden = true;
  E.countdown.hidden = false;
  E.countdown.dataset.color = colorOf(m.from);
  E.countBy.textContent = m.from === myId ? 'Iniciaste la cuenta' : `${m.name || nameOf(m.from)} inició la cuenta`;
  E.countLabel.textContent = typeof m.t === 'number'
    ? `Pongan ${fmt(m.t)} y denle play en cero.`
    : 'Denle play cuando llegue a cero.';
  clearInterval(S.countTimer);
  const tick = () => {
    const rem = at - Date.now();
    if (rem > 3000) E.countNum.textContent = 'Listos';
    else if (rem > 0) E.countNum.textContent = String(Math.ceil(rem / 1000));
    else {
      E.countNum.textContent = 'Play';
      vibrate(200);
      clearInterval(S.countTimer);
      setTimeout(() => { E.countdown.hidden = true; }, 1500);
    }
  };
  tick();
  S.countTimer = setInterval(tick, 100);
}

function showPauseAll(m) {
  E.pauseOv.dataset.color = colorOf(m.from);
  E.pauseText.textContent = `${m.name || nameOf(m.from)} pidió pausa`;
  E.pauseOv.hidden = false;
  vibrate([120, 80, 120]);
  clearTimeout(S.pauseTimer);
  S.pauseTimer = setTimeout(() => { E.pauseOv.hidden = true; }, 3500);
}
E.pauseOv.addEventListener('click', () => { E.pauseOv.hidden = true; });

/* ---------------- Invitar ---------------- */

function inviteUrl() {
  return `${location.origin}${location.pathname}?sala=${S.code}`;
}

async function copy(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    toast(`Copia este enlace: ${text}`, null, 12000);
  }
}

E.share.addEventListener('click', async () => {
  if (!S.code) return;
  const url = inviteUrl();
  const text = `Ven a ver conmigo en DualVision. Código de sala: ${S.code}`;
  if (navigator.share && isMobile) {
    try { await navigator.share({ title: 'DualVision', text, url }); return; } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  copy(url, 'Enlace copiado. Pégalo en WhatsApp o donde quieras.');
});

E.codeTiles.addEventListener('click', () => S.code && copy(S.code, `Código ${S.code} copiado.`));

/* ---------------- Ventana flotante ---------------- */

async function openDocumentPip() {
  const pip = await window.documentPictureInPicture.requestWindow({ width: 340, height: 540 });
  S.pip = pip;
  for (const sheet of document.styleSheets) {
    try {
      const css = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      const st = pip.document.createElement('style');
      st.textContent = css;
      pip.document.head.append(st);
    } catch {
      if (sheet.href) {
        const link = pip.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        pip.document.head.append(link);
      }
    }
  }
  pip.document.head.append(document.querySelector('svg defs').closest('svg').cloneNode(true));
  pip.document.title = 'DualVision';
  pip.document.body.className = 'pip-body';
  const home = E.side.parentNode;
  pip.document.body.append(E.side);
  for (const v of $$('video', E.side)) v.play().catch(() => {});
  E.float.setAttribute('aria-pressed', 'true');
  pip.addEventListener('pagehide', () => {
    home.append(E.side);
    for (const v of $$('video', E.side)) v.play().catch(() => {});
    S.pip = null;
    E.float.setAttribute('aria-pressed', 'false');
  });
}

E.float.addEventListener('click', async () => {
  if (S.pip) { S.pip.close(); return; }
  if ('documentPictureInPicture' in window && !isMobile) {
    try { await openDocumentPip(); return; } catch (err) { console.warn(err); }
  }
  if (document.pictureInPictureElement) {
    try { await document.exitPictureInPicture(); } catch {}
    return;
  }
  const tile = S.peers.map((p) => S.tiles.get(p.id)).find((t) => t && t.video.srcObject && t.el.classList.contains('cam-on'));
  if (!tile) {
    toast('Cuando la otra persona prenda su cámara, podrás verla en una ventana flotante.');
    return;
  }
  const v = tile.video;
  try {
    if (v.requestPictureInPicture && document.pictureInPictureEnabled) await v.requestPictureInPicture();
    else if (v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture')) v.webkitSetPresentationMode('picture-in-picture');
    else toast('Este navegador no permite ventanas flotantes.');
  } catch (err) {
    console.warn(err);
    toast('No se pudo abrir la ventana flotante. Vuelve a tocar el botón.');
  }
});

/* ---------------- Extensión de PC ---------------- */

function tellExtension() {
  if (!S.code) return;
  window.postMessage({
    __dualvision: 'room', code: S.code, name: S.me.name, owner: myId,
    service: S.stage.mode === 'stream' ? S.stage.service : null
  }, '*');
}

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__dualvision !== 'ext-ready') return;
  S.hasExt = true;
  tellExtension();
  if (!E.stream.hidden) renderStream();
});

/* ---------------- Arranque ---------------- */

updateControls();
if (isMobile) E.stream.insertBefore($('.manual', E.stream), E.streamExt);
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.DualVision = { S, enterRoom, leaveRoom };
