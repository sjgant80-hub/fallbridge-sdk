# @ai-native-solutions/fallbridge-sdk

Web Bluetooth GATT bridge for BLE-mesh dongles.

Your browser cannot advertise, cannot be a peripheral, cannot join a mesh. But it CAN connect over GATT to a dongle that can. That is the whole trick.

Pair with an ESP32 or nRF52 dongle running Meshtastic (or bitchat, or any BLE-UART firmware exposing the Nordic UART Service). Read peers, send messages, subscribe to incoming. Register the bridge as a FallCarrier transport and other estate apps route via the mesh when available.

Chrome / Edge desktop, Chrome on Android. iOS Safari does not support Web Bluetooth.

## Install

```bash
npm install @ai-native-solutions/fallbridge-sdk
```

Or ESM CDN:

```html
<script type="module">
  import { FallBridge } from 'https://unpkg.com/@ai-native-solutions/fallbridge-sdk/src/index.js';
</script>
```

## Quick start

```js
import { FallBridge } from '@ai-native-solutions/fallbridge-sdk';

const bridge = new FallBridge({ debug: true });

bridge.onState((s) => console.log('state', s));
bridge.onMessage((m) => console.log(m.dir, m.text));
bridge.onPeer((p) => console.log('peer', p.id, p.rssi));

await bridge.pair();          // browser shows chooser
await bridge.send('hello mesh');
await bridge.send('psst', 'node-42');       // direct to peer
await bridge.sendHex('48 65 6c 6c 6f 0a');  // raw bytes
const batt = await bridge.getBattery();     // % or null
const peers = bridge.getPeers();
```

## FallCarrier transport

```js
window.FallCarrier?.register(bridge.asCarrierTransport());
// -> FallMail, FallReach, any estate app now routes via BLE mesh when connected.
```

## API

| Method | Returns | Notes |
|---|---|---|
| `new FallBridge({ debug, namePrefix, mtu })` | instance | `namePrefix` narrows the chooser filter |
| `pair()` | `Promise<boolean>` | Opens Web Bluetooth chooser |
| `disconnect()` | `Promise<void>` | |
| `send(text, dest?)` | `Promise<number>` | bytes written |
| `sendHex(hex)` | `Promise<number>` | space/colon/dash separators allowed |
| `sendBytes(Uint8Array)` | `Promise<number>` | |
| `getBattery()` | `Promise<number\|null>` | percentage, or null if no battery service |
| `getPeers()` | `Peer[]` | sorted most-recent first |
| `clearPeers()` | `void` | |
| `onState(fn)` | unsubscribe fn | `{ state, name?, protocol? }` |
| `onMessage(fn)` | unsubscribe fn | `{ dir, text, from?, hops?, rssi?, raw?, ts }` |
| `onPeer(fn)` | unsubscribe fn | fires on any peer update |
| `asCarrierTransport()` | transport | `{ name, available, send, onReceive, getPeers }` |
| `.connected` | `boolean` | |
| `.protocol` | `'nus'\|'meshtastic'` | negotiated at pair time |

## Supported dongles

Anything that exposes the **Nordic UART Service** (NUS) or the Meshtastic BLE service:

- **LILYGO T-Beam v1.2** — ESP32 + LoRa + GPS. The workhorse.
- **LILYGO T-Echo** — nRF52 + e-paper + LoRa. Pocketable.
- **Heltec V3 LoRa32** — ESP32-S3 + LoRa + OLED. Cheapest ticket in.
- **RAK4631** — nRF52840 + LoRa. Best power efficiency for solar nodes.

Flash Meshtastic at [flasher.meshtastic.org](https://flasher.meshtastic.org/). Two minutes.

## Playground

`docs/index.html` runs a full pair-send-receive playground straight from GitHub Pages: <https://sjgant80-hub.github.io/fallbridge-sdk/>

## License

MIT.
