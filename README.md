# Cloud LED Simulator (WLED / DDP)

A 3D simulation of an LED strip wrapped in a spiral around an ellipsoidal
cloud, with per-LED shading from movable scene lights. The same colors that
appear on screen are streamed to a real
[WLED](https://kno.wled.ge/) controller over UDP using the
[DDP](http://www.3waylabs.com/ddp/) protocol via a tiny local Node relay.

## Workspaces

```
/                # npm workspaces root
├── app/         # Vite + React + R3F frontend (port 5173)
└── relay/       # Node WebSocket → UDP/DDP relay (port 7890)
```

## Prerequisites

- Node.js 20+ (tested on 26)
- A WLED controller on the same LAN with DDP enabled (default in recent
  firmware — verify under _Config → Sync Interfaces → Network → DDP_).

## Install & run

```bash
npm install
npm run dev
```

That starts both the Vite dev server (http://localhost:5173) and the relay
(`ws://localhost:7890`). The app connects to the relay automatically when
you toggle **WLED → stream** on.

You can also run them separately:

```bash
npm run dev:app
npm run dev:relay
```

## Controls

The leva panel exposes:

- **Ellipsoid (m)** — `rx, ry, rz` semi-axes of the cloud shape, in metres.
- **Cloud** —
  - `opacity (light)`: how much the cloud body blocks light. 0 = fully
    transparent (soft half-Lambert: side LEDs at 50%, back tapers smoothly
    to 0). 1 = fully opaque (hard flat-Lambert: only the light-facing half
    is lit, the entire shadow side is pitch black with a hard terminator
    at the equator). The slider blends linearly between the two.
  - `show cloud`: visual-only toggle. When off, the ellipsoid mesh is
    hidden; the shading still uses the `opacity` value.
- **Strand** — `count` (number of LEDs), `turns` (number of helical wraps
  from start to the antipodal point), `start` (one of `top`, `bottom`,
  `left`, `right`, `front`, `back` — the strand always ends at the opposite
  side), `LED size (m)`.
- **Lights** — ambient color/intensity, directional color/intensity, and the
  directional light's orbit around the cloud:
  - `spread (0=narrow, 1=broad)`: angular spread of the light, mapped
    exponentially so the slider feels smooth from end to end. 0 = a
    laser-tight spotlight (only LEDs within roughly a 6° cone of the light
    direction read bright; everything else is essentially black,
    regardless of cloud opacity). 1 = a broad hemispherical sky (wraps
    around the LED's outward hemisphere; side and back LEDs catch
    progressively less, modulated by cloud opacity). See "How shading
    works" for the math — at `spread = 1` the response collapses to the
    previous formula exactly, so existing saved presets are unchanged.
  - `azimuth (°)`: 0–360°, sweeps the light around the vertical (y) axis.
  - `elevation (°)`: 0°–360°, full pitch cycle so you can keep rotating
    through every angle without hitting a hard stop.
  - `distance`: radius from the origin. A true directional light has no
    distance falloff (parallel rays from infinity), so the app applies a
    softened inverse-square attenuation `25 / (25 + d²)` to both the
    custom LED shading and the three.js light that lights the ellipsoid
    mesh. At the default position (≈ 5.4 from origin) attenuation is
    ≈ 0.46, so dragging distance lower brightens the cloud and dragging
    higher dims it.

  A small unlit sphere shows where the light is. Saved snapshots still
  store the position as Cartesian under the hood — the panel just exposes
  spherical coordinates because they're much nicer for "rotate around the
  object".
- **Sky Cycle** — an additional time-driven sun + moon system (separate
  from the manual directional light):
  - `enable sky cycle`: toggles the sequence.
  - `24h cycle (sec)`: playback speed when auto play is on (auto play is
    toggled from the timeline overlay, see below).
  - `ambient/sun/moon scale`: intensity trims for each sky component.

  While Sky Cycle is enabled, manual ambient + directional lights are
  automatically dimmed to 20% so they do not wash out sky colors.
- **Sky Timeline overlay** (top of the screen, above the 3D view) — a
  24-hour draggable timeline that owns the colors of the sky cycle:
  - The playhead (green vertical bar) shows the current hour, driven by
    auto-play or shift-clicking a track to scrub.
  - **Sun / moon altitude arcs** are drawn above the tracks:
    - The golden arc peaks at 12:00 (sun at zenith); a small sun icon
      slides along it, tracking the actual sun position used by the
      lighting model. It hides when the sun is below the horizon.
    - The pale-blue arc peaks at 00:00 / 24:00 (moon at zenith), with a
      moon icon that similarly follows the moon's altitude and hides
      when the moon is below the horizon.
    - Because both curves share the same sinusoid the shading uses, the
      icons on the arcs match what the sun/moon markers do in the 3D
      scene — this makes it easy to see, at any hour, where each body
      is in the sky and which one is currently lighting the cloud.
  - **Three independent channel tracks** — Sun, Moon, and Ambient —
    stacked vertically below the arcs. Each track holds its own
    draggable list of color stops:
    - The track's background is a live gradient of the interpolated
      color across the entire 24 hours, so each track doubles as a
      preview of that channel's color over the day.
    - **Pins** are colored circles showing that stop's single color.
      Their tooltip labels the channel, time, and swatch (e.g.
      `sun · 12:00 · Noon sky`).
    - **Drag** a pin left/right along its own track to change when its
      color applies. Sun stops move independently of moon/ambient
      stops, and vice-versa.
    - **Click** a pin to open an inline editor showing the channel
      name, the exact time, a color picker (with hex input), and a
      swatch dropdown + preset chip row. Because each channel edits
      only one color, the swatch chips show that channel's slice of
      each preset (e.g. for the ambient track, chips show ambient
      colors).
    - **Delete** in the editor removes the pin.
    - **Click on empty track area** to add a new stop on that channel
      at that time (seeded from the `Rose dawn` swatch, and immediately
      opens the editor).
  - **Auto-play** is toggled by the ▶ / ❚❚ button in the timeline
    header. Playback speed still lives in the Leva **Sky Cycle** folder.

  Colors on each channel are linearly interpolated between the two
  nearest pins on that channel's track, wrapping across midnight. This
  means the sun color at, say, 10 AM depends only on the two sun stops
  around 10 AM — the moon and ambient tracks can have completely
  different stop schedules. The physical intensity envelope for the
  sun/moon (bright at noon, absent at night, twilight glow around
  dawn/dusk) is decoupled from the color stops and driven purely by
  the time of day.
- **WLED** — `stream` toggle, `host` (IP/hostname of your WLED controller),
  `fps` (frame rate cap for the UDP stream).

There's also a small **RGB histogram** overlay in the bottom-left that shows
the distribution of the exact bytes being sent to WLED — 16 bins of 16 byte
values each, grouped R/G/B bars, log-scaled. Mirrors the histogram in the
sibling `cloud-bottom-leds` project.

## Save / load

The **Presets** folder in the leva panel has `save` and `load` buttons.

- `save` writes a snapshot of every control (ellipsoid, cloud, strand,
  lights, WLED host & fps) to `localStorage` under
  `cloudLeds.settings.v1`.
- `load` reads that snapshot back and pushes the values into both the
  zustand store and the leva sliders, so the panel updates without a
  refresh.
- On startup the app **auto-loads** the saved snapshot if one exists, so
  refreshes preserve your work. The `WLED → stream` toggle is always
  forced to `off` when loading (saved or auto-loaded) so reopening the
  app can't accidentally start blasting UDP to the strip.

## How shading works

Each LED has a position on the ellipsoid surface and an outward unit normal.
For every frame we approximate the **average light hitting the outward-facing
hemisphere** at each LED — a viewer-independent signal you can later combine
with other effects.

For a single directional light at angle θ from the outward normal `n`
(`c = n · ℓ`), the response is the sum of a *direct* term (a Phong-style
cosine lobe pointed at the light source) and a *wrap* term (extra light
reaching the side/back hemisphere from a broad source):

    N(β)      = 128^(1 − β)                         // cosine exponent, 1 … 128 (exponential)
    direct(c) = max(0, c)^N(β)
    wrap(c)   = (1 + c) / 2 − max(0, c)             // ≥ 0, peaks at c = 0
    shade(c, β, α) = direct(c) + β · (1 − α) · wrap(c)

The two manual sliders compose orthogonally:

- `β` is the directional light's `spread` (a property of the light).
- `α` is the cloud's `opacity` (a property of the medium).

As `β` decreases (light gets narrower):

- `N` grows exponentially from 1 to 128, tightening the direct lobe.
  Half-angle (where direct = 0.5) goes from 60° at β = 1 to ~23° at
  β = 0.5 to ~6° at β = 0. The β = 0 setting is a real spotlight: an
  LED 15° off-axis already reads only ≈ 0.03.
- The wrap weight `β · (1 − α)` falls to 0, so side/back LEDs go dark.

As `α` increases (cloud gets opaque) it independently kills the wrap
term, so the shadow side darkens even for broad lights.

Distance also matters: a real directional light has no distance falloff,
so the app applies `25 / (25 + d²)` (with `d` = distance from origin) to
the light's intensity before shading. This affects both the LEDs and
the three.js light shading the ellipsoid mesh, so the two stay in sync.

With Sky Cycle enabled, two additional directional lights are evaluated
every frame:

- **Sun**: follows a physically plausible day arc (rises around 06:00,
  highest near 12:00, sets around 18:00), with warm/cool pastel tint
  changing by phase.
- **Moon**: opposite the sun on the sky dome, strongest around midnight,
  cool-blue tint, and naturally weaker than the sun.

Both sun and moon contributions run through the same LED shading and cloud
opacity model, so cloud opacity consistently controls back-side attenuation
across all times of day.

To preserve warm sunset reds/oranges at high brightness, LED output uses
hue-preserving highlight compression instead of per-channel hard clipping.
This prevents bright mixed lighting from bleaching toward white.

Corner cases:

- `β = 0` (narrow): `max(0, c)^128`. A laser-tight spot beam. Cloud
  opacity has no effect because there's no wrap to attenuate.
- `β = 1`, `α = 0` (broad, transparent): `(1 + c) / 2` — pure
  half-Lambert. Side LEDs at 0.5.
- `β = 1`, `α = 1` (broad, opaque): `max(0, c)` — flat Lambert. The
  cloud blocks all wrap.
- `β = 1`, any α: exactly the previous opacity-blends-Lamberts formula,
  so pre-existing presets render identically at default spread.

For each frame we compute this per LED (ambient + directional + any point
lights) and write the result to:

1. the instanced sphere's color buffer (so the on-screen LEDs match), and
2. a `Uint8Array` of `count × 3` bytes that's sent to the relay via
   WebSocket.

The relay wraps that buffer in a DDP header and forwards it as a UDP packet
to `<host>:4048`. WLED renders it on the strip in real time.

## Mapping to the physical strand

The simulation assumes the strand starts at the chosen cardinal pole of the
ellipsoid (e.g. `top` = `+Y`) and ends at the antipode (e.g. `bottom`),
wrapping `turns` times in between. LEDs are placed **equidistantly along
the 3D curve** — i.e. consecutive LEDs are the same arc-length apart, the
same way a real LED strip with uniform LED pitch sits on the cloud.

Implementation: the parametric spiral is densely sampled (~32 × LED count
+ 256 points), the cumulative chord length is built as a prefix-sum table,
and each LED's `t` is found by inverse interpolation against
`i × total / (n−1)`. See [app/src/geometry/spiral.ts](app/src/geometry/spiral.ts).

Note: with many `turns`, the spiral winds tightly near the poles, so even
though strand spacing is uniform, the LEDs are spatially denser near the
poles than at the equator. Lower `turns` if you want a more spatially even
distribution.

## Troubleshooting the stream

If you toggled **stream on** but the physical LEDs don't change:

1. Look at the small **status line** above the histogram (bottom-left):
   - Grey dot, "stream off" → toggle is off in the leva WLED panel.
   - Orange dot, "no relay (ws disconnected)" → the Node relay isn't running.
     Run `npm run dev:relay` (or `npm run dev` for both).
   - Green dot, "→ host:port  sent N  dropped 0" → the browser is happily
     pushing frames to the relay; problem is downstream (network or WLED).
2. Check the relay terminal. On the first successful UDP packet you'll see
   `[udp] first packet sent to <host>:4048 (... bytes, ... LEDs)` and a
   periodic `[udp] N frames forwarded` line. If you see `[udp] send error`,
   the OS can't reach `<host>` — DNS lookup failed or the address is
   unreachable from the machine running the relay.
3. The `host` field accepts URLs, plain IPs, and `host:port` forms; the
   client strips the scheme/path/port before talking to the relay. Examples
   that all resolve to `10.0.4.54`: `10.0.4.54`, `http://10.0.4.54/`,
   `10.0.4.54:80`.
4. On the WLED controller, enable real-time / DDP under
   _Config → Sync Interfaces → Network → DDP_. Also confirm
   _Receive UDP port_ shows `4048` (the protocol default) and that
   the LED count there matches `count` in the simulator.
5. macOS firewalls (Little Snitch, LuLu) sometimes silently drop outbound
   UDP from `node`. Allow `node` for outgoing UDP if the relay terminal
   shows packets forwarded but the LEDs don't react.

## DDP details

- Header: 10 bytes, `flags=0x41` (VER1+PUSH), `seq` cycles 1..15, `type=0x0B`
  (RGB 24bpp), `id=1`, `offset=0`, `length=count*3`.
- Port: 4048.
- Max LEDs in one packet: ~480 for safe MTU, but WLED accepts larger UDP
  packets that get fragmented; for very long strips fragmenting yourself is
  more reliable. (Not implemented here — current code sends a single
  packet.)

## Known limitations / out of scope

- LED spacing is parametric, not arc-length-equal.
- Single strand only — no multi-segment or multi-controller support.
- Single DDP packet per frame (no fragmentation), so very long strips
  (>~1500 LEDs) may need chunking.
- Shading is simple Lambertian, not PBR; matches scene look but won't
  reproduce HDR/specular effects.
- No preset saving/loading.
