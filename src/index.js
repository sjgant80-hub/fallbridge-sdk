/**
 * @ai-native-solutions/fallbridge-sdk
 *
 * Web Bluetooth GATT bridge for BLE-mesh dongles (Meshtastic, bitchat, any BLE-UART).
 *
 * The browser cannot advertise, cannot be a peripheral, cannot join a mesh.
 * But it CAN connect to a GATT peripheral that can. That is the whole trick.
 *
 * Pair with an ESP32 or nRF52 mesh dongle over Web Bluetooth GATT.
 * Read peers, send messages, subscribe to incoming, expose as a FallCarrier transport.
 *
 * Chrome/Edge desktop, Chrome Android. iOS Safari does not support Web Bluetooth.
 *
 * MIT.
 */

// Nordic UART Service (NUS) - the de-facto BLE-UART standard.
// Meshtastic BLE, bitchat, adafruit BLEUART, and most hobby firmware all speak NUS.
const NUS_SERVICE       = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_CHAR       = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notify (dongle -> browser)
const NUS_RX_CHAR       = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // write   (browser -> dongle)

// Meshtastic service (alternative protocol - the dongle exposes both NUS and this)
const MESHTASTIC_SERVICE = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
const MESHTASTIC_FROMRADIO = '2c55e69e-4993-11ed-b878-0242ac120002';
const MESHTASTIC_TORADIO   = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
const MESHTASTIC_FROMNUM   = 'ed9da18c-a800-4f66-a670-aa7547e34453';

// Standard BLE battery service.
const BATTERY_SERVICE     = 'battery_service';
const BATTERY_LEVEL_CHAR  = 'battery_level';

const DEFAULT_MTU = 20; // conservative BLE 4.0 payload

export class FallBridge {
  constructor(opts = {}) {
    this.debug = !!opts.debug;
    this.namePrefix = opts.namePrefix || null; // filter by device name prefix
    this.mtu = opts.mtu || DEFAULT_MTU;

    this.device = null;
    this.server = null;
    this.rxChar = null;   // browser writes here
    this.txChar = null;   // browser reads notifications from here
    this.batteryChar = null;
    this.protocol = null; // 'nus' | 'meshtastic'
    this.connected = false;

    this._peers = new Map();  // id -> {id, name, rssi, hops, lastSeen}
    this._stateListeners = [];
    this._msgListeners   = [];
    this._peerListeners  = [];
    this._rxBuffer = '';
    this._decoder = new TextDecoder();
    this._encoder = new TextEncoder();
  }

  // ---------- lifecycle ----------

  async pair() {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      throw new Error('Web Bluetooth not available. Use Chrome or Edge desktop, or Chrome on Android.');
    }
    this._emitState({ state: 'requesting' });

    const filters = this.namePrefix
      ? [{ namePrefix: this.namePrefix }]
      : [
          { services: [NUS_SERVICE] },
          { services: [MESHTASTIC_SERVICE] },
          { namePrefix: 'Meshtastic' },
          { namePrefix: 'T-Beam' },
          { namePrefix: 'T-Echo' },
          { namePrefix: 'Heltec' },
          { namePrefix: 'RAK' },
        ];

    this.device = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices: [NUS_SERVICE, MESHTASTIC_SERVICE, BATTERY_SERVICE],
    });

    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnect());

    this._emitState({ state: 'connecting', name: this.device.name || 'device' });
    this.server = await this.device.gatt.connect();

    // Try Meshtastic first (richer protocol), fall back to NUS.
    try {
      const svc = await this.server.getPrimaryService(MESHTASTIC_SERVICE);
      this.rxChar = await svc.getCharacteristic(MESHTASTIC_TORADIO);
      this.txChar = await svc.getCharacteristic(MESHTASTIC_FROMRADIO);
      this.protocol = 'meshtastic';
    } catch (_) {
      const svc = await this.server.getPrimaryService(NUS_SERVICE);
      this.rxChar = await svc.getCharacteristic(NUS_RX_CHAR);
      this.txChar = await svc.getCharacteristic(NUS_TX_CHAR);
      this.protocol = 'nus';
    }

    await this.txChar.startNotifications();
    this.txChar.addEventListener('characteristicvaluechanged', (e) => this._onRx(e.target.value));

    // Battery is optional.
    try {
      const bs = await this.server.getPrimaryService(BATTERY_SERVICE);
      this.batteryChar = await bs.getCharacteristic(BATTERY_LEVEL_CHAR);
    } catch (_) { /* device has no battery service */ }

    this.connected = true;
    this._emitState({
      state: 'connected',
      name: this.device.name || 'device',
      protocol: this.protocol,
    });
    if (this.debug) console.log('[fallbridge] connected', this.device.name, this.protocol);
    return true;
  }

  async disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    else this._onDisconnect();
  }

  _onDisconnect() {
    this.connected = false;
    this.rxChar = null;
    this.txChar = null;
    this.batteryChar = null;
    this._emitState({ state: 'disconnected' });
    if (this.debug) console.log('[fallbridge] disconnected');
  }

  // ---------- I/O ----------

  async send(text, dest = null) {
    if (!this.connected || !this.rxChar) throw new Error('not connected');
    const payload = dest ? `@${dest} ${text}` : text;
    const bytes = this._encoder.encode(payload + '\n');
    await this._writeChunked(bytes);
    this._emitMsg({
      dir: 'out',
      text,
      dest: dest || 'ALL',
      ts: Date.now(),
    });
    return bytes.length;
  }

  async sendHex(hexStr) {
    if (!this.connected || !this.rxChar) throw new Error('not connected');
    const clean = String(hexStr).replace(/[^0-9a-fA-F]/g, '');
    if (clean.length % 2) throw new Error('hex must be even length');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    await this._writeChunked(bytes);
    return bytes.length;
  }

  async sendBytes(bytes) {
    if (!this.connected || !this.rxChar) throw new Error('not connected');
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    await this._writeChunked(bytes);
    return bytes.length;
  }

  async _writeChunked(bytes) {
    for (let i = 0; i < bytes.length; i += this.mtu) {
      const chunk = bytes.slice(i, i + this.mtu);
      if (this.rxChar.writeValueWithoutResponse) {
        await this.rxChar.writeValueWithoutResponse(chunk);
      } else {
        await this.rxChar.writeValue(chunk);
      }
    }
  }

  async getBattery() {
    if (!this.batteryChar) return null;
    const v = await this.batteryChar.readValue();
    return v.getUint8(0);
  }

  // ---------- RX parsing ----------

  _onRx(dataView) {
    const bytes = new Uint8Array(dataView.buffer);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');

    // Try to decode as UTF-8 text; if the payload looks binary keep the hex.
    let text = '';
    try { text = this._decoder.decode(bytes); } catch (_) {}

    // Buffer partial lines for line-oriented firmwares.
    this._rxBuffer += text;
    const lines = this._rxBuffer.split(/\r?\n/);
    this._rxBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line) continue;
      const parsed = this._parseLine(line);
      this._emitMsg({
        dir: 'in',
        text: parsed.text,
        from: parsed.from,
        hops: parsed.hops,
        rssi: parsed.rssi,
        raw: hex,
        ts: Date.now(),
      });
      if (parsed.from) this._touchPeer(parsed);
    }

    // If there were no complete lines, still surface a raw frame.
    if (!lines.length && bytes.length) {
      this._emitMsg({
        dir: 'in',
        text: text.replace(/[\x00-\x08\x0e-\x1f]/g, ''),
        raw: hex,
        ts: Date.now(),
      });
    }
  }

  /**
   * Parse a text line from the dongle.
   * Accepts either plain text or the common `[id name rssi hops] body` tag format
   * used by hobby BLE-UART mesh firmwares.
   */
  _parseLine(line) {
    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!m) return { text: line };
    const tag = m[1];
    const body = m[2];
    const parts = tag.split(/\s+/);
    // id [name] [rssi] [hops]
    const out = { text: body, from: parts[0] };
    for (const p of parts.slice(1)) {
      if (/^-?\d+dBm$/i.test(p)) out.rssi = parseInt(p, 10);
      else if (/^\d+h$/i.test(p)) out.hops = parseInt(p, 10);
      else if (!out.name) out.name = p;
    }
    return out;
  }

  _touchPeer({ from, name, rssi, hops }) {
    const cur = this._peers.get(from) || { id: from };
    if (name) cur.name = name;
    if (rssi !== undefined) cur.rssi = rssi;
    if (hops !== undefined) cur.hops = hops;
    cur.lastSeen = Date.now();
    this._peers.set(from, cur);
    for (const l of this._peerListeners) { try { l(cur); } catch (_) {} }
  }

  getPeers() {
    return Array.from(this._peers.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }

  clearPeers() { this._peers.clear(); }

  // ---------- events ----------

  onState(fn)   { this._stateListeners.push(fn); return () => this._off(this._stateListeners, fn); }
  onMessage(fn) { this._msgListeners.push(fn);   return () => this._off(this._msgListeners, fn); }
  onPeer(fn)    { this._peerListeners.push(fn);  return () => this._off(this._peerListeners, fn); }
  _off(arr, fn) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }

  _emitState(s) { for (const l of this._stateListeners) { try { l(s); } catch (_) {} } }
  _emitMsg(m)   { for (const l of this._msgListeners)   { try { l(m); } catch (_) {} } }

  // ---------- FallCarrier transport shape ----------
  // A carrier-transport object exposes: name, available(), send(msg), onReceive(cb).

  asCarrierTransport() {
    const self = this;
    return {
      name: 'fallbridge-ble-mesh',
      available: () => self.connected,
      send: (payload) => {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const dest = (typeof payload === 'object' && payload?.to) ? payload.to : null;
        return self.send(text, dest);
      },
      onReceive: (cb) => self.onMessage((m) => { if (m.dir === 'in') cb(m); }),
      getPeers: () => self.getPeers(),
    };
  }
}

export default FallBridge;
