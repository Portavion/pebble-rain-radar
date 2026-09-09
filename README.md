# Rainradar

Pebble Time 2 app that shows rain radar around your phone's GPS fix. The phone downloads the maps. The watch keeps one frame. Up and Down walk the last hour and the next hour in 15-minute steps. Select jumps to the latest observed frame.

Radar tiles come from [LibreWXR](https://librewxr.net/) (EUMETNET OPERA over the UK and France, plus a 60-minute nowcast). Radar data is CC-BY-4.0. If that host is down, the app falls back to RainViewer's past-only tiles. Future slots then show "no data".

## Build

```sh
pebble build
pebble install --emulator emery
pebble install --phone <ip>
```

Needs the Pebble SDK (`uv tool install pebble-tool`, then `pebble sdk install latest`) and the Core Devices / Rebble phone app with developer connection on.

## Buttons

- Up: 15 minutes earlier
- Down: 15 minutes later
- Select: latest observed frame

The footer shows the frame's real clock time. Source frames are 10 minutes apart, so a 15-minute step snaps to the nearest one.

## Checks

```sh
node tools/check-catalog.js
node tools/check-png.js
python3 tools/pebbleize.py
```
