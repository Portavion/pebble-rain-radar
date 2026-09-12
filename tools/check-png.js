var fs = require("fs");
var path = require("path");
var png = require("../src/pkjs/png");

var src = path.join(__dirname, "fixtures", "ukz5.png");
var dest = path.join(__dirname, "fixtures", "ukz5-js-pebble.png");
var radar = png.readPng(fs.readFileSync(src));
var map = png.solidRgba(radar.width, 170, 211, 223);
var out = png.compose(map, radar.width, radar, 200, 200);
fs.writeFileSync(dest, Buffer.from(out));
if (out[0] !== 0x89 || out[1] !== 0x50) {
  throw new Error("sig");
}
if (out[25] !== 3) {
  throw new Error("color " + out[25]);
}
if (out.length < 100) {
  throw new Error("tiny");
}
if (out.length > 40000) {
  throw new Error("too big " + out.length);
}
var view = png.mapView(51.5074, -0.1278, 9, 256);
if (view.tiles.length < 1 || view.tiles.length > 4) {
  throw new Error("tiles " + view.tiles.length);
}
var labeled = png.mapToPebblePng(png.solidRgba(256, 170, 200, 180), 256, 200, 200, view);
if (labeled.length < 100 || labeled.length > 40000) {
  throw new Error("map png " + labeled.length);
}
var rain = png.rainOnlyPng(png.readPng(fs.readFileSync(src)), 200, 200);
if (rain.length < 50 || rain.length > 40000) {
  throw new Error("rain png " + rain.length);
}
var painted = 0;
var i;
for (i = 0; i < radar.rgba.length; i += 4) {
  if (radar.rgba[i + 3] >= 24) {
    painted++;
  }
}
if (painted < 100) {
  throw new Error("fixture rain");
}
var water = png.solidRgba(8, 170, 208, 224);
png.styleMap(water);
if (water[0] !== 170 || water[1] !== 170 || water[2] !== 170) {
  throw new Error("styleMap water " + water[0] + "," + water[1] + "," + water[2]);
}
var land = png.solidRgba(8, 242, 226, 170);
png.styleMap(land);
if (land[0] !== 255 || land[1] !== 255 || land[2] !== 255) {
  throw new Error("styleMap land " + land[0] + "," + land[1] + "," + land[2]);
}
var road = png.solidRgba(8, 209, 135, 100);
png.styleMap(road);
if (road[0] === 255 && road[1] === 255 && road[2] === 255) {
  throw new Error("styleMap bleached road");
}
var z7 = png.solidRgba(256, 136, 221, 238);
var z9map = png.solidRgba(256, 255, 255, 255);
var cropped = png.composeFrame(z9map, 256, { width: 256, height: 256, rgba: z7 }, 200, 200, view, 7, 9);
if (cropped[0] !== 0x89 || cropped[25] !== 3) {
  throw new Error("composeFrame png");
}
if (cropped.length < 100 || cropped.length > 40000) {
  throw new Error("composeFrame " + cropped.length);
}
console.log("ok", out.length, "rain", painted, "overlay", rain.length, "crop", cropped.length);
