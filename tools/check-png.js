var fs = require("fs");
var path = require("path");
var png = require("../src/pkjs/png");

var src = path.join(__dirname, "fixtures", "ukz5.png");
var dest = path.join(__dirname, "fixtures", "ukz5-js-pebble.png");
var out = png.toPebblePng(fs.readFileSync(src), 200, 200);
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
console.log("ok", out.length);
