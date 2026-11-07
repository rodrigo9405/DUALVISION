const $ = (s) => document.querySelector(s);
$('#open-app').href = self.DV_CONFIG.appUrl;

function render(st) {
  const inRoom = !!(st && st.room);
  $('#in-room').hidden = !inRoom;
  $('#no-room').hidden = inRoom;
  if (!inRoom) return;
  $('#code').replaceChildren(...st.room.code.split('').map((c) => Object.assign(document.createElement('span'), { textContent: c })));
  const people = (st.members || []).filter((m) => m.kind === 'web' || m.kind === 'ext');
  const byPerson = new Map();
  for (const m of people) {
    const key = m.owner || m.id;
    const prev = byPerson.get(key) || { name: m.name, web: false, ext: false };
    if (m.kind === 'web') prev.web = true; else prev.ext = true;
    prev.name = prev.name || m.name;
    byPerson.set(key, prev);
  }
  $('#state').className = st.online ? 'state on' : 'state';
  $('#state').textContent = st.online
    ? `Conectado como ${st.room.name}. ${byPerson.size} ${byPerson.size === 1 ? 'persona' : 'personas'} en la sala.`
    : 'Conectando con la sala…';
  $('#members').replaceChildren(...[...byPerson.values()].map((p) => {
    const li = document.createElement('li');
    li.textContent = p.name + ' ';
    const small = document.createElement('small');
    small.textContent = p.ext ? (p.web ? 'en la página y con extensión' : 'con extensión') : 'solo en la página';
    li.append(small);
    return li;
  }));
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'popup-status' }, (st) => render(st));
}

chrome.storage.local.get(['room', 'lastName'], ({ room, lastName }) => {
  if (lastName) $('#name').value = lastName;
  if (!room) render(null);
  refresh();
});
setInterval(refresh, 1500);

$('#room-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#name').value.trim();
  const code = $('#room-code').value.trim().toUpperCase();
  if (!name) { $('#error').textContent = 'Escribe tu nombre.'; return; }
  if (!/^[A-Z0-9]{6}$/.test(code)) { $('#error').textContent = 'El código tiene 6 letras y números.'; return; }
  $('#error').textContent = '';
  chrome.storage.local.set({ lastName: name });
  chrome.runtime.sendMessage({ type: 'join', room: { code, name } }, (res) => {
    if (res && !res.ok) { $('#error').textContent = res.error; return; }
    setTimeout(refresh, 600);
  });
});

$('#leave').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'leave' }, () => refresh());
});
