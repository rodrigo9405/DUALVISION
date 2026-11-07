// YouTube dentro de la sala, sincronizado para todos.
// Quien da play, pausa o adelanta manda la orden; los demás la aplican.

export function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let url;
  try { url = new URL(s.startsWith('http') ? s : 'https://' + s); } catch { return null; }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  if (host === 'youtu.be') return url.pathname.slice(1, 12) || null;
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const v = url.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = url.pathname.match(/\/(?:shorts|live|embed|v)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

let apiPromise = null;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(new Error('No se pudo cargar YouTube')); };
    document.head.append(s);
  });
  return apiPromise;
}

const PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export class YouTubeSync {
  constructor({ mount, send, onBlocked, onError, onAction }) {
    this.mount = mount;
    this.send = send;
    this.onBlocked = onBlocked;
    this.onError = onError;
    this.onAction = onAction;
    this.player = null;
    this.ready = false;
    this.videoId = null;
    this.expect = null;
    this.quietUntil = 0;
    this.controller = null;
    this.lastTick = null;
    this.pendingApply = null;
    this.watch = setInterval(() => this._watchSeek(), 700);
    this.tick = setInterval(() => this._heartbeat(), 3000);
  }

  async load(videoId, { t = 0, playing = false } = {}) {
    this.videoId = videoId;
    const YT = await loadApi();
    if (this.player && this.ready) {
      this._expect(playing ? 'playing' : 'paused');
      if (playing) this.player.loadVideoById({ videoId, startSeconds: t });
      else this.player.cueVideoById({ videoId, startSeconds: t });
      if (playing) this._checkPlaying();
      return;
    }
    if (this.player) {
      this.pendingApply = { action: playing ? 'play' : 'pause', t, sentAt: Date.now() };
      return;
    }
    const el = document.createElement('div');
    this.mount.replaceChildren(el);
    this.pendingApply = { action: playing ? 'play' : 'pause', t, sentAt: Date.now() };
    this.player = new YT.Player(el, {
      width: '100%',
      height: '100%',
      videoId,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(t) },
      events: {
        onReady: () => {
          this.ready = true;
          const p = this.pendingApply;
          this.pendingApply = null;
          if (p) this.apply(p);
        },
        onStateChange: (e) => this._onState(e.data),
        onError: (e) => this.onError && this.onError(e.data)
      }
    });
  }

  time() {
    try { return this.player && this.ready ? this.player.getCurrentTime() || 0 : 0; } catch { return 0; }
  }

  isPlaying() {
    try { return this.ready && this.player.getPlayerState() === PLAYING; } catch { return false; }
  }

  snapshot() {
    if (!this.videoId) return null;
    return { videoId: this.videoId, t: this.time(), playing: this.isPlaying(), sentAt: Date.now() };
  }

  // Marca el estado que esperamos después de aplicar una orden remota,
  // para no reenviarla como si fuera nuestra.
  _expect(state) {
    this.expect = { state, until: Date.now() + 2500 };
    this.quietUntil = Date.now() + 1500;
  }

  _onState(state) {
    if (state === BUFFERING || state === CUED) return;
    this.lastTick = { t: this.time(), at: Date.now(), playing: state === PLAYING };
    const now = Date.now();
    const got = state === PLAYING ? 'playing' : state === PAUSED ? 'paused' : null;
    if (!got) return;
    if (this.expect && now < this.expect.until && this.expect.state === got) {
      this.expect = null;
      return;
    }
    this._emit(got === 'playing' ? 'play' : 'pause');
  }

  _emit(action) {
    const t = this.time();
    const last = this.lastEmit;
    if (last && last.action === action && Date.now() - last.at < 1200 && Math.abs(last.t - t) < 2) return;
    this.lastEmit = { action, t, at: Date.now() };
    this.controller = 'me';
    this.send({ action, t, videoId: this.videoId, sentAt: Date.now() });
    this.onAction && this.onAction({ action, t, mine: true });
  }

  // Detecta cuando alguien adelanta o retrocede con la barra.
  _watchSeek() {
    if (!this.ready || !this.player) return;
    const now = Date.now();
    const t = this.time();
    const playing = this.isPlaying();
    const prev = this.lastTick;
    this.lastTick = { t, at: now, playing };
    if (!prev || now < this.quietUntil) return;
    const expected = prev.t + (prev.playing && playing ? (now - prev.at) / 1000 : 0);
    if (Math.abs(t - expected) > 1.5) this._emit(playing ? 'play' : 'pause');
  }

  _heartbeat() {
    if (!this.ready || this.controller !== 'me' || !this.isPlaying()) return;
    this.send({ action: 'tick', t: this.time(), videoId: this.videoId, sentAt: Date.now() });
  }

  apply(msg) {
    if (!msg) return;
    if (msg.videoId && msg.videoId !== this.videoId) {
      this.load(msg.videoId, { t: msg.t || 0, playing: msg.action === 'play' || msg.action === 'tick' });
      return;
    }
    if (!this.ready) { this.pendingApply = msg; return; }
    const lag = msg.sentAt ? clamp((Date.now() - msg.sentAt) / 1000, 0, 2) : 0;
    if (msg.from) this.controller = msg.from;
    if (msg.action === 'play') {
      const target = (msg.t || 0) + lag;
      this._expect('playing');
      if (Math.abs(this.time() - target) > 0.7) this.player.seekTo(target, true);
      if (this.isPlaying()) this.expect = null;
      this.player.playVideo();
      this._checkPlaying();
    } else if (msg.action === 'pause') {
      this._expect('paused');
      if (!this.isPlaying()) this.expect = null;
      this.player.pauseVideo();
      if (Math.abs(this.time() - (msg.t || 0)) > 0.7) this.player.seekTo(msg.t || 0, true);
    } else if (msg.action === 'tick') {
      const target = (msg.t || 0) + lag;
      if (Math.abs(this.time() - target) > 2) {
        this.quietUntil = Date.now() + 1500;
        this.player.seekTo(target, true);
      }
      if (!this.isPlaying()) {
        this._expect('playing');
        this.player.playVideo();
        this._checkPlaying();
      }
    }
  }

  // En celulares el navegador puede bloquear el play automático: pedimos un toque.
  _checkPlaying() {
    clearTimeout(this._blockTimer);
    this._blockTimer = setTimeout(() => {
      if (!this.isPlaying() && this.onBlocked) this.onBlocked();
    }, 2200);
  }

  // Llamado desde un toque del usuario.
  resumeFromTap(target) {
    if (!this.ready) return;
    this._expect('playing');
    if (typeof target === 'number') this.player.seekTo(target, true);
    this.player.playVideo();
  }

  destroy() {
    clearInterval(this.watch);
    clearInterval(this.tick);
    clearTimeout(this._blockTimer);
    try { this.player && this.player.destroy(); } catch {}
    this.player = null;
    this.ready = false;
    this.mount.replaceChildren();
  }
}
