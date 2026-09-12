# Rainradar

Pebble Time 2 app that shows rain radar around your phone's GPS fix, or a location you set. The phone downloads OpenStreetMap tiles at zoom 9 (about 50 km, a Greater London-sized window) and radar tiles, composites them into one 200x200 palettized PNG per time slot, and sends that frame to the watch. Up and Down walk the last hour and the next hour in 15-minute steps. Select jumps to the latest observed frame.

Source: [github.com/Portavion/pebble-rain-radar](https://github.com/Portavion/pebble-rain-radar).

Past frames come from [RainViewer](https://www.rainviewer.com/) at zoom 7, cropped into the zoom-9 map. Nowcast frames come from [LibreWXR](https://librewxr.net/) (EUMETNET OPERA, CC-BY-4.0) at zoom 9. If RainViewer is down, past slots use LibreWXR. If LibreWXR is down, future slots show "no data".

The basemap is [Esri World Street Map](https://www.arcgis.com/home/item.html?id=3b93337983e9436f8db950e38a8629af) (legacy raster export). Phone JS washes cream land to white and water to grey so cyan-yellow-red rain is the only bright colour; brown roads and town names stay. If Esri is down, the same wash runs on [OpenStreetMap](https://www.openstreetmap.org/copyright) Carto tiles (`tile.openstreetmap.de`, then `tile.openstreetmap.fr`, then `tile.openstreetmap.org`). Sources: Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community.

## Build

```sh
pebble build
pebble install --cloudpebble
pebble install --emulator emery
```

Needs the Pebble SDK (`uv tool install pebble-tool`, then `pebble sdk install latest`) and the Core Devices / Rebble phone app with developer connection on.

## Settings

In the Rebble phone app, tap the gear next to Rainradar. On the emulator, `pebble emu-app-config`.

Phone GPS tries the phone first and falls back to the saved lat/lon if the fix fails or is missing. Fixed location skips GPS and uses only those coordinates. Until you change them, the saved point is London (51.5074, -0.1278), so the emulator still works without a GPS API. Saving recenters the radar window and drops the old map tiles.

## Buttons

- Up: 15 minutes earlier
- Down: 15 minutes later
- Select: latest observed frame

The footer shows the frame's real clock time. Source frames are 10 minutes apart, so a 15-minute step snaps to the nearest one.

## Checks

```sh
node tools/check-catalog.js
node tools/check-png.js
node tools/check-location.js
```