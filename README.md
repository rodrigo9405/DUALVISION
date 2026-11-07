# DualVision

Mira películas, series y videos al mismo tiempo con otra persona, cada uno desde su pantalla.

**Página:** https://rodrigo9405.github.io/DUALVISION/

## Qué hace

- **Salas con código.** Una persona crea la sala y comparte el código de 6 caracteres o el enlace. Entran hasta 4 personas.
- **YouTube dentro de la sala.** Se pega un enlace y el video aparece para todos. Play, pausa y adelantar se sincronizan solos, en PC y en celular.
- **Netflix, Disney+, Prime Video, HBO Max y Crunchyroll con la cuenta de cada uno.** Estas plataformas no dejan mostrar sus videos dentro de otra app, así que cada persona los abre con su propia cuenta:
  - **En PC**, la extensión de Chrome sincroniza play, pausa y adelantar automáticamente, muestra el código de la sala sobre el video y avisa si alguien está viendo otro título.
  - **En celular**, la sala tiene una cuenta regresiva compartida ("pongan 12:34 y denle play en cero") y un botón de pausa para todos. Si alguien en PC tiene la extensión, el celular ve en vivo en qué minuto va.
- **Cámara, micrófono y chat** entre todos los de la sala, con reacciones.
- **Ventana flotante:** en PC, las cámaras y el chat pasan a una ventana que queda encima de Netflix, incluso en pantalla completa. En celular, la cámara de la otra persona flota encima de la app.
- **Se instala como app** en el celular: en Chrome o Safari, *Agregar a la pantalla de inicio*.

## Instalar la extensión (PC)

1. Descarga [`dualvision-extension.zip`](dualvision-extension.zip) y descomprímelo.
2. Abre `chrome://extensions` (en Edge, `edge://extensions`) y activa el **Modo de desarrollador**.
3. Toca **Cargar descomprimida** y elige la carpeta `dualvision-extension`.
4. Entra a la sala desde la página de DualVision: la extensión se une sola. También se puede unir desde su ícono.

Funciona en Chrome, Edge, Brave y Opera. Cada persona en PC que quiera sincronía automática la instala en su navegador.

## Cómo está hecho

- **Frontend:** página estática (`index.html`, `css/`, `js/`) publicada con GitHub Pages. Sin build.
- **Tiempo real:** Supabase Realtime (proyecto `DUALVISION`, región São Paulo). Cada sala es un canal `dv:<código>`: presencia para saber quién está, y mensajes para chat, reacciones, sincronía y señales de video.
- **Video y voz:** WebRTC entre los navegadores (cada conexión va directo de persona a persona; Supabase solo ayuda a que se encuentren).
- **Base de datos:** solo la tabla `salas` (código y última actividad). Nadie la lee directamente: se usa con las funciones `crear_sala()` y `entrar_sala(código)`. Las salas sin uso por 30 días se borran solas. Ver `supabase/01_salas.sql`.
- **Extensión:** Manifest V3. `background.js` mantiene la conexión con la sala, `player.js` controla el video de cada plataforma, `netflix-main.js` usa el reproductor de Netflix para adelantar (Netflix da error si se cambia el video directamente), `site.js` une la extensión a la sala abierta en la web.
- La clave `sb_publishable_…` del código es pública por diseño.

## Estructura

```
index.html                 App (inicio y sala)
css/app.css                Estilos
js/app.js                  Lógica de la app
js/room.js                 Sala en tiempo real
js/rtc.js                  Cámara y micrófono (WebRTC)
js/youtube.js              YouTube sincronizado
config.js                  URL y clave pública de Supabase
sw.js, manifest.webmanifest  Instalación como app
extension/                 Código de la extensión
dualvision-extension.zip   Extensión lista para instalar
supabase/01_salas.sql      Tabla y funciones de salas
```

## Límites conocidos

- La sincronía con Netflix, Disney+ y las demás se probó con un reproductor simulado; las plataformas cambian sus páginas de vez en cuando y puede hacer falta ajustar la extensión.
- La cámara y el micrófono conectan directo entre dispositivos. En algunas redes muy cerradas (ciertos datos móviles o redes de empresa) hace falta un servidor TURN para que conecten.
- En iPhone, al cambiar de Safari a la app de Netflix, iOS puede pausar la cámara y el micrófono de la página.
- La extensión se instala en modo desarrollador porque no está publicada en la Chrome Web Store.
- El proyecto gratuito de Supabase se pausa tras una semana sin uso; se reactiva desde el panel de Supabase.
