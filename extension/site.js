// Corre en la página de DualVision: así la extensión se une sola a la sala abierta.
(() => {
  document.documentElement.dataset.dvExt = chrome.runtime.getManifest().version;
  window.postMessage({ __dualvision: 'ext-ready' }, '*');
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data.__dualvision !== 'string') return;
    const d = e.data;
    try {
      if (d.__dualvision === 'room' && /^[A-Z0-9]{6}$/.test(String(d.code))) {
        chrome.storage.local.set({
          room: { code: d.code, name: String(d.name || 'Alguien').slice(0, 20), owner: String(d.owner || '') }
        });
      } else if (d.__dualvision === 'leave') {
        chrome.storage.local.remove('room');
      }
    } catch {
      // La extensión se actualizó: la próxima recarga de la página la vuelve a conectar.
    }
  });
})();
