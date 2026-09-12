var location = require("../src/pkjs/location");

var def = location.load(null);
if (def.mode !== "gps" || def.lat !== 51.5074 || def.lon !== -0.1278) {
  throw new Error("defaults");
}

var fixed = location.load({ LocMode: "fixed", Lat: "48.8566", Lon: "2.3522" });
if (fixed.mode !== "fixed" || fixed.lat !== 48.8566 || fixed.lon !== 2.3522) {
  throw new Error("fixed");
}

var bad = location.load({ LocMode: "nope", Lat: "x", Lon: "200" });
if (bad.mode !== "gps" || bad.lat !== 51.5074 || bad.lon !== -0.1278) {
  throw new Error("invalid");
}

var mem = {
  store: '{"LocMode":"fixed","Lat":"53.4808","Lon":"-2.2426"}',
  getItem: function () {
    return this.store;
  }
};
var saved = location.fromStorage(mem);
if (saved.mode !== "fixed" || saved.lat !== 53.4808 || saved.lon !== -2.2426) {
  throw new Error("storage");
}

if (location.fromStorage(null).mode !== "gps") {
  throw new Error("empty storage");
}

console.log("ok");
