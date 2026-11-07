// DualVision: conexión de la extensión con la sala (Supabase Realtime).
// Las pestañas de Netflix, Disney+, etc. hablan con este archivo, y este con la sala.
importScripts('vendor/supabase.js', 'config.js');

const cfg = self.DV_CONFIG;
const S = {
  sb: null, ch: null, room: null, online: false, members: [],
  extId: null, ports: new Set(), lastRemote: null, myService: null, connecting: null
};

function client() {
  if (!S.sb) {
    S.sb = self.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { heartbeatIntervalMs: 20000 }
    });
  }
  return S.sb;
}

async function getExtId() {
  if (S.extId) return S.extId;
  const got = await chrome.storage.local.get('extId');
  S.extId = got.extId || 'x' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  if (!got.extId) await chrome.storage.local.set({ extId: S.extId });
  return S.extId;
}

function status() {
  return { type: 'status', online: S.online, room: S.room, members: S.members };
}

function toPorts(msg) {
  for (const p of S.ports) {
    try { p.postMessage(msg); } catch { S.ports.delete(p); }
  }
}

function flatten(state) {
  const out = [];
  for (const [key, metas] of Object.entries(state || {})) {
    const m = metas[metas.length - 1];
    if (m) out.push({ ...m, key });
  }
  return out;
}

function retrack() {
  if (!S.ch || !S.online || !S.room) return;
  Promise.resolve(S.ch.track({
    id: S.extId, kind: 'ext', name: S.room.name, owner: S.room.owner || null, service: S.myService
  })).catch(() => {});
}

async function connect(room) {
  if (room && S.room && S.ch && S.room.code === room.code) {
    const changed = S.room.name !== room.name || S.room.owner !== room.owner;
    S.room = room;
    if (changed) retrack();
    toPorts(status());
    return;
  }
  await disconnect();
  if (!room) return;
  S.room = room;
  await getExtId();
  const ch = client().channel('dv:' + room.code, {
    config: { broadcast: { self: false, ack: false }, presence: { key: S.extId } }
  });
  S.ch = ch;
  for (const ev of ['xcmd', 'xstate', 'count', 'pauseall']) {
    ch.on('broadcast', { event: ev }, (msg) => onRemote(ev, (msg && msg.payload) || {}));
  }
  ch.on('presence', { event: 'sync' }, () => {
    if (S.ch !== ch) return;
    S.members = flatten(ch.presenceState());
    toPorts(status());
  });
  ch.subscribe((st) => {
    if (S.ch !== ch) return;
    if (st === 'SUBSCRIBED') { S.online = true; retrack(); }
    else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') S.online = false;
    toPorts(status());
  });
}

async function disconnect() {
  const ch = S.ch;
  S.ch = null;
  S.online = false;
  S.members = [];
  S.lastRemote = null;
  S.room = null;
  if (ch) {
    try { await ch.untrack(); } catch {}
    try { await S.sb.removeChannel(ch); } catch {}
  }
  toPorts(status());
}

function onRemote(ev, payload) {
  const receivedAt = Date.now();
  if (ev === 'xcmd' || ev === 'xstate') S.lastRemote = { ...payload, ev, receivedAt };
  toPorts({ type: 'remote', ev, payload, receivedAt });
}

function send(ev, data) {
  if (!S.ch || !S.online || !S.room) return;
  Promise.resolve(S.ch.send({
    type: 'broadcast', event: ev,
    payload: { ...data, from: S.extId, name: S.room.name, sentAt: Date.now() }
  })).catch(() => {});
}

async function ensureConnected() {
  if (S.ch) return;
  if (S.connecting) return S.connecting;
  S.connecting = (async () => {
    const { room } = await chrome.storage.local.get('room');
    if (room && !S.ch) await connect(room);
  })().finally(() => { S.connecting = null; });
  return S.connecting;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.room) return;
  const room = changes.room.newValue;
  if (room) connect(room); else disconnect();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'player') return;
  S.ports.add(port);
  port.onDisconnect.addListener(() => S.ports.delete(port));
  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'hello') {
      port.postMessage(status());
      const last = S.lastRemote;
      if (last && Date.now() - last.receivedAt < 15000) {
        port.postMessage({ type: 'remote', ev: 'xstate', payload: last, receivedAt: last.receivedAt, catchUp: true });
      }
    } else if (msg.type === 'cmd') {
      send('xcmd', msg.data);
    } else if (msg.type === 'state') {
      if (msg.data && msg.data.service !== S.myService) { S.myService = msg.data.service; retrack(); }
      send('xstate', msg.data);
    }
  });
  ensureConnected();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'popup-status') {
    ensureConnected().then(() => sendResponse(status()));
    return true;
  }
  if (msg.type === 'join' && msg.room && /^[A-Z0-9]{6}$/.test(msg.room.code)) {
    (async () => {
      const { data, error } = await client().rpc('entrar_sala', { p_codigo: msg.room.code });
      if (error) return sendResponse({ ok: false, error: 'No hay conexión con DualVision. Revisa tu internet.' });
      if (!data) return sendResponse({ ok: false, error: `No existe una sala con el código ${msg.room.code}.` });
      await chrome.storage.local.set({ room: { code: msg.room.code, name: String(msg.room.name || 'Alguien').slice(0, 20), owner: '' } });
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg.type === 'leave') {
    chrome.storage.local.remove('room').then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.alarms.create('dv-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'dv-keepalive') ensureConnected(); });
chrome.runtime.onStartup.addListener(ensureConnected);
chrome.runtime.onInstalled.addListener(ensureConnected);
ensureConnected();
