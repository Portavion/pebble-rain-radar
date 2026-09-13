var geocode = require("../src/pkjs/geocode");
var location = require("../src/pkjs/location");

var def = location.load(null);
if (def.mode !== "gps" || def.lat !== 51.5074 || def.lon !== -0.1278 || def.city !== "") {
  throw new Error("defaults");
}

var fixed = location.load({ LocMode: "fixed", Lat: "48.8566", Lon: "2.3522", City: " Paris " });
if (fixed.mode !== "fixed" || fixed.lat !== 48.8566 || fixed.lon !== 2.3522 || fixed.city !== "Paris") {
  throw new Error("fixed");
}

var bad = location.load({ LocMode: "nope", Lat: "x", Lon: "200" });
if (bad.mode !== "gps" || bad.lat !== 51.5074 || bad.lon !== -0.1278) {
  throw new Error("invalid");
}

var mem = {
  store: '{"LocMode":"fixed","Lat":"53.4808","Lon":"-2.2426","City":"Manchester"}',
  getItem: function () {
    return this.store;
  }
};
var saved = location.fromStorage(mem);
if (saved.mode !== "fixed" || saved.lat !== 53.4808 || saved.lon !== -2.2426 || saved.city !== "Manchester") {
  throw new Error("storage");
}

if (location.fromStorage(null).mode !== "gps") {
  throw new Error("empty storage");
}

function storage(json) {
  return {
    data: {},
    getItem: function (key) {
      return this.data[key] || null;
    },
    setItem: function (key, value) {
      this.data[key] = value;
    }
  };
}

function seed(raw) {
  var box = storage();
  box.setItem(location.STORAGE_KEY, JSON.stringify(raw));
  return box;
}

var parisJson = [
  {
    lat: "48.858644",
    lon: "2.294189",
    display_name: "Paris, France",
    name: "Paris"
  }
];

geocode.reset();
var box = seed({ LocMode: "gps", Lat: "51.5074", Lon: "-0.1278", City: "Paris" });
var resolved = null;
location.resolve(box, function (url, done) {
  if (url.indexOf("Paris") < 0) {
    throw new Error("resolve url");
  }
  done(null, parisJson);
}, function (err, loc) {
  resolved = loc;
});
if (
  !resolved ||
  resolved.mode !== "fixed" ||
  resolved.lat !== 48.858644 ||
  resolved.lon !== 2.294189 ||
  resolved.city !== "Paris, France"
) {
  throw new Error("resolve");
}
var wrote = JSON.parse(box.getItem(location.STORAGE_KEY));
if (wrote.LocMode !== "fixed" || wrote.City !== "Paris, France") {
  throw new Error("resolve write");
}

var net = 0;
location.resolve(box, function (url, done) {
  net++;
  done(null, parisJson);
}, function (err, loc) {
  resolved = loc;
});
if (net !== 0 || resolved.lat !== 48.858644 || resolved.mode !== "fixed") {
  throw new Error("resolve cache");
}

geocode.reset();
box = seed({ LocMode: "fixed", Lat: "53.4808", Lon: "-2.2426", City: "" });
location.resolve(box, function () {
  throw new Error("empty city net");
}, function (err, loc) {
  resolved = loc;
});
if (resolved.mode !== "fixed" || resolved.lat !== 53.4808 || resolved.city !== "") {
  throw new Error("empty city");
}

geocode.reset();
box = seed({ LocMode: "gps", Lat: "51.5074", Lon: "-0.1278", City: "Paris" });
location.resolve(box, function (url, done) {
  done(new Error("net"));
}, function (err, loc) {
  resolved = loc;
});
if (resolved.mode !== "gps" || resolved.lat !== 51.5074) {
  throw new Error("resolve fail");
}

console.log("ok");
