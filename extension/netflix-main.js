// Netflix no permite adelantar cambiando el <video> directamente (muestra un error),
// así que usamos su propio reproductor desde el contexto de la página.
(() => {
  function player() {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = vp.getAllPlayerSessionIds();
      const id = ids.find((s) => s.startsWith('watch')) || ids[0];
      return id ? vp.getVideoPlayerBySessionId(id) : null;
    } catch {
      return null;
    }
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data.__dvnf !== 'string') return;
    const p = player();
    const v = document.querySelector('video');
    const cmd = e.data.__dvnf;
    try {
      if (cmd === 'seek' && p) p.seek(Math.max(0, Math.round(e.data.ms)));
      else if (cmd === 'play') (p ? p.play() : v && v.play());
      else if (cmd === 'pause') (p ? p.pause() : v && v.pause());
    } catch {
      if (cmd === 'play' && v) v.play().catch(() => {});
      if (cmd === 'pause' && v) v.pause();
    }
  });
})();
