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
var view = png.mapView(51.5074, -0.1278, 5, 256);
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
console.log("ok", out.length, "rain", painted, "overlay", rain.length);
