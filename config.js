// Configuración pública de DualVision.
// La clave de Supabase es pública por diseño: las salas no guardan datos privados.
window.DV_CONFIG = {
  supabaseUrl: 'https://blbatdnfsynhuvlrieay.supabase.co',
  supabaseKey: 'sb_publishable_iobIDXJcPn2mMkxRv9ZOBA_d4gUyFKb',
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  extensionZip: 'dualvision-extension.zip',
  maxPeople: 4,
  version: '0.1.0'
};
