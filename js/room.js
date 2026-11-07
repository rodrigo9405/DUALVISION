// Sala en tiempo real sobre Supabase Realtime (broadcast + presence).
// No guarda nada: todo lo que pasa en la sala viaja entre los participantes.

export const ROOM_EVENTS = [
  'hello', 'state', 'stage', 'chat', 'react', 'yt', 'signal',
  'count', 'pauseall', 'xstate', 'xcmd'
];

export class Room {
  constructor(sb, code, meta) {
    this.sb = sb;
    this.code = code;
    this.meta = { ...meta };
    this.handlers = {};
    this.ready = false;
    this.ch = sb.channel('dv:' + code, {
      config: { broadcast: { self: false, ack: false }, presence: { key: meta.id } }
    });
    for (const ev of ROOM_EVENTS) {
      this.ch.on('broadcast', { event: ev }, (msg) => this.emit(ev, (msg && msg.payload) || {}));
    }
    this.ch.on('presence', { event: 'sync' }, () => this.emit('presence', this.members()));
  }

  on(ev, fn) {
    (this.handlers[ev] ||= []).push(fn);
    return this;
  }

  emit(ev, data) {
    for (const fn of this.handlers[ev] || []) {
      try { fn(data); } catch (err) { console.error('[DualVision]', ev, err); }
    }
  }

  members() {
    const state = this.ch.presenceState();
    const out = [];
    for (const [key, metas] of Object.entries(state)) {
      const m = metas[metas.length - 1];
      if (m) out.push({ ...m, key });
    }
    return out;
  }

  connect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('timeout')); }
      }, timeoutMs);
      this.ch.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          this.ready = true;
          this.ch.track(this.meta).catch(() => {});
          this.emit('status', 'online');
          if (!settled) { settled = true; clearTimeout(timer); resolve(); }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.ready = false;
          this.emit('status', 'offline');
          if (!settled && status !== 'CLOSED') {
            settled = true; clearTimeout(timer); reject(err || new Error(status));
          }
        }
      });
    });
  }

  update(patch) {
    Object.assign(this.meta, patch);
    if (this.ready) return this.ch.track(this.meta).catch(() => {});
  }

  send(event, payload = {}) {
    if (!this.ready) return;
    return this.ch.send({ type: 'broadcast', event, payload: { ...payload, from: this.meta.id } });
  }

  async leave() {
    this.ready = false;
    try { await this.ch.untrack(); } catch {}
    try { await this.sb.removeChannel(this.ch); } catch {}
  }
}
