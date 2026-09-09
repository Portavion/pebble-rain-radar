# Rainradar

Pebble Time 2 app that shows rain radar around your phone's GPS fix. The phone downloads OpenStreetMap and radar tiles, palettizes them, and sends one 200x200 frame to the watch. Up and Down walk the last hour and the next hour in 15-minute steps. Select jumps to the latest observed frame.

Source: [github.com/Portavion/pebble-rain-radar](https://github.com/Portavion/pebble-rain-radar).

Radar tiles come from [LibreWXR](https://librewxr.net/) (EUMETNET OPERA over the UK and France, plus a 60-minute nowcast). Radar data is CC-BY-4.0. If that host is down, the app falls back to RainViewer's past-only tiles. Future slots then show "no data". Map tiles are © OpenStreetMap. Rain colours follow the usual UK radar scale: cyan through yellow and red.

## Build

```sh
pebble build
pebble install --cloudpebble
pebble install --emulator emery
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
```