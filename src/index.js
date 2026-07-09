// fallbridge SDK · sovereign single-file library · MIT · AI-Native Solutions
// Extracted from fallbridge/index.html · 5549 bytes of source logic
// Public-safe: no primes/glyphs/dyad references

import { FallBridge } from './fallbridge.js';
const bridge = new FallBridge({ debug: true });
window.__fallbridge = bridge;
// tabs
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.remove('on'));
  $$('.view').forEach(x => x.classList.remove('on'));
  t.classList.add('on');
  $(`.view[data-v="${t.dataset.view}"]`).classList.add('on');
}));
// bluetooth availability check
if (!navigator.bluetooth) {
  $('#btwarn').style.display = 'block';
  $('#pairBtn').disabled = true;
}
// pair
$('#pairBtn').addEventListener('click', async () => {
  try {
    $('#pairBtn').disabled = true;
    $('#statusText').textContent = 'requesting…';
    await bridge.pair();
  } catch(e) {
    console.error(e);
    $('#statusText').textContent = 'error: ' + e.message;
    $('#pairBtn').disabled = false;
  }
});
$('#discBtn').addEventListener('click', () => bridge.disconnect());
$('#battBtn').addEventListener('click', async () => {
  const b = await bridge.getBattery();
  $('#batt').textContent = b === null ? 'unavailable' : (b + ' %');
});
// send text
$('#sendBtn').addEventListener('click', async () => {
  const text = $('#msgIn').value.trim();
  if (!text) return;
  const dest = $('#destSel').value;
  try {
    await bridge.send(text, dest || null);
    $('#msgIn').value = '';
  } catch(e) { alert('send failed: ' + e.message); }
});
$('#msgIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#sendBtn').click(); }
});
// hex terminal
$('#hexSend').addEventListener('click', async () => {
  const h = $('#hexIn').value.trim();
  if (!h) return;
  try {
    const n = await bridge.sendHex(h);
    appendTerm(`> [${n}B] ${h}`);
    $('#hexIn').value = '';
  } catch(e) { alert('hex send failed: ' + e.message); }
});
// carrier toggle
$('#carrierToggle').addEventListener('click', () => {
  const el = $('#carrierToggle');
  el.classList.toggle('on');
  const on = el.classList.contains('on');
  const d = el.querySelector('.d');
  if (on) {
    const t = bridge.asCarrierTransport();
  } else {
    }
    d.textContent = 'Off — apps in this tab won\'t route via BLE mesh.';
  }
  updateCarrier();
});
function updateCarrier() {
  $('#carrierAvail').textContent = bridge.connected ? 'yes' : 'no (not paired)';
}
// state updates
bridge.onState((s) => {
  const on = s.state === 'connected';
  $('#dot').classList.toggle('on', on);
  $('#statusText').textContent = s.state;
  if (s.name) $('#devName').textContent = s.name;
  if (s.protocol) $('#proto').innerHTML = `<span class="pill on">${s.protocol}</span>`;
  $('#sendBtn').disabled = !on;
  $('#hexSend').disabled = !on;
  $('#battBtn').disabled = !on;
  $('#discBtn').disabled = !on;
  $('#pairBtn').disabled = on;
  updateCarrier();
});
// message stream
bridge.onMessage((m) => {
  const stream = $('#stream');
  if (stream.querySelector('.empty')) stream.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'msg ' + m.dir;
  const ts = new Date(m.ts).toLocaleTimeString();
  const meta = [];
  if (m.dir === 'out') meta.push(`→ ${m.dest}`);
  if (m.dir === 'in') {
    meta.push(`from ${m.from}`);
    if (m.hops) meta.push(`${m.hops} hops`);
    if (m.rssi) meta.push(`${m.rssi} dBm`);
  }
  meta.push(ts);
  el.innerHTML = `<div class="meta">${meta.map(x => `<span>${x}</span>`).join('')}</div><div>${escapeHtml(m.text)}</div>`;
  stream.appendChild(el);
  stream.scrollTop = stream.scrollHeight;
  // terminal
  if (m.dir === 'in') {
    appendTerm(`< ${m.raw ? m.raw + '  ·  ' : ''}${m.text}`);
  }
});
// peers
bridge.onPeer((p) => renderPeers());
function renderPeers() {
  const peers = bridge.getPeers();
  $('#peerCount').textContent = peers.length;
  const grid = $('#peersGrid');
  if (!peers.length) { grid.innerHTML = '<div class="empty">No peers heard yet.</div>'; return; }
  grid.innerHTML = peers.map(p => `
    <div class="peer">
      <div class="id">${escapeHtml(p.id)}</div>
      <div class="name">${escapeHtml(p.name || p.id)}</div>
      <div class="meta">${p.rssi || '—'} dBm · ${p.hops || 0} hops · ${timeAgo(p.lastSeen)}</div>
    </div>`).join('');
  // dest selector
  const sel = $('#destSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Broadcast (ALL)</option>' + peers.map(p =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join('');
  sel.value = cur;
}
function appendTerm(line) {
  const t = $('#termLog');
  if (t.textContent.startsWith('// awaiting')) t.textContent = '';
  t.textContent += line + '\n';
  t.scrollTop = t.scrollHeight;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function timeAgo(ts) { const s = Math.floor((Date.now() - ts)/1000); if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s/60) + 'm ago'; return Math.floor(s/3600) + 'h ago'; }
// register SW
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

// Named exports for the primary API surface
export { updateCarrier };
export { renderPeers };
export { appendTerm };
export { escapeHtml };
export { timeAgo };
export { $ };
export { $$ };


