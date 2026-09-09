var fs = require("fs");
var https = require("https");
var path = require("path");
var catalog = require("../src/pkjs/catalog");
var png = require("../src/pkjs/png");

var LAT = 51.5074;
var LON = -0.1278;
var MAX = 40000;

function get(url) {
  return new Promise(function (resolve, reject) {
    https
      .get(url, { headers: { "User-Agent": "Rainradar/1.0" } }, function (res) {
        var chunks = [];
        res.on("data", function (c) {
          chunks.push(c);
        });
        res.on("end", function () {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(url + " " + res.statusCode));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      })
      .on("error", reject);
  });
}

function rainHits(rgba) {
  var hits = 0;
  var opaque = 0;
  var i;
  for (i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] >= 48) {
      opaque++;
    }
    if (png.rainColor(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])) {
      hits++;
    }
  }
  return { hits: hits, opaque: opaque, pixels: rgba.length / 4 };
}

function overlayDelta(mapRgba, radar) {
  var mapSize = Math.round(Math.sqrt(mapRgba.length / 4));
  var radarRgba = radar.rgba;
  if (radar.width !== mapSize || radar.height !== mapSize) {
    radarRgba = png.scaleNearest(radar.rgba, radar.width, radar.height, mapSize, mapSize);
  }
  var over = png.overlay(mapRgba, radarRgba, mapSize * mapSize);
  var changed = 0;
  var i;
  for (i = 0; i < over.length; i += 4) {
    if (over[i] !== mapRgba[i] || over[i + 1] !== mapRgba[i + 1] || over[i + 2] !== mapRgba[i + 2]) {
      changed++;
    }
  }
  return { changed: changed, mapSize: mapSize };
}

function report(label, radar, mapRgba) {
  var hits = rainHits(radar.rgba);
  var delta = overlayDelta(mapRgba, radar);
  var composed = png.compose(mapRgba, delta.mapSize, radar, 200, 200);
  var mapPng = png.mapToPebblePng(mapRgba, delta.mapSize, 200, 200);
  var washed = png.rgbaToPebblePng(
    png.washRadar(new Uint8Array(radar.rgba)),
    radar.width,
    radar.height,
    200,
    200
  );
  console.log(
    JSON.stringify({
      label: label,
      rainHits: hits.hits,
      opaque: hits.opaque,
      pixels: hits.pixels,
      overlayChanged: delta.changed,
      composeBytes: composed.length,
      mapBytes: mapPng.length,
      washBytes: washed.length,
      composeOver40k: composed.length > MAX,
      mapOver40k: mapPng.length > MAX
    })
  );
}

function fixture() {
  var src = path.join(__dirname, "fixtures", "ukz5.png");
  var radar = png.readPng(fs.readFileSync(src));
  var map = png.solidRgba(radar.width, 170, 211, 223);
  report("fixture", radar, map);
}

async function live(name, catalogUrl) {
  var json = JSON.parse((await get(catalogUrl)).toString("utf8"));
  var cat = catalog.parseCatalog(json, LAT, LON);
  var frame = catalog.pickFrame(cat, catalog.NOW);
  if (!frame) {
    console.log(JSON.stringify({ label: name, error: "no now frame" }));
    return;
  }
  var url = catalog.tileUrl(cat, frame, catalog.TILE_ZOOM);
  var buf = await get(url);
  var radar = png.readPng(buf);
  var map = png.solidRgba(256, 85, 170, 85);
  console.log(JSON.stringify({ label: name + "-url", url: url, bytes: buf.length }));
  report(name, radar, map);
}

async function main() {
  console.log(
    JSON.stringify({
      premise:
        "One GBitmap on s_frame_layer. drop_frame before decode. overlayChanged must be > 0 and composeBytes <= 40000.",
      actors: ["frame_layer", "rainColor", "overlay", "slot_png"],
      layerOrder: ["window", "frame", "crosshair", "footer", "loading"]
    })
  );
  fixture();
  await live("rainviewer", "https://api.rainviewer.com/public/weather-maps.json");
  await live("librewxr", "https://api.librewxr.net/public/weather-maps.json");
}

main().catch(function (e) {
  console.error(e.stack || e);
  process.exit(1);
});
