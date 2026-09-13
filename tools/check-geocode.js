var geocode = require("../src/pkjs/geocode");

var paris = [
  {
    lat: "48.858644",
    lon: "2.294189",
    display_name: "Paris, France",
    name: "Paris"
  }
];

geocode.reset();

var hit = geocode.parse(paris);
if (!hit || hit.lat !== 48.858644 || hit.lon !== 2.294189 || hit.name !== "Paris, France") {
  throw new Error("parse");
}

if (geocode.parse([]) !== null) {
  throw new Error("empty");
}
if (geocode.parse([{ lat: "x", lon: "0" }]) !== null) {
  throw new Error("bad");
}
if (geocode.parse([{ lat: "91", lon: "0" }]) !== null) {
  throw new Error("range");
}

var url = geocode.searchUrl("Paris");
if (url.indexOf("nominatim.openstreetmap.org/search") < 0 || url.indexOf("Paris") < 0) {
  throw new Error("url");
}

var calls = 0;
function mockGet(u, done) {
  calls++;
  if (u.indexOf("Paris") < 0) {
    throw new Error("query");
  }
  done(null, paris);
}

var result = null;
geocode.search("Paris", mockGet, function (err, found) {
  result = found;
});
if (!result || result.lat !== 48.858644 || calls !== 1) {
  throw new Error("search");
}

geocode.search("Paris", mockGet, function () {});
geocode.search("paris", mockGet, function () {});
geocode.search("Paris, France", mockGet, function () {});
if (calls !== 1) {
  throw new Error("cache");
}

var blank = "x";
geocode.search("", mockGet, function (err, found) {
  blank = found;
});
if (blank !== null || calls !== 1) {
  throw new Error("blank");
}

var failErr = null;
geocode.search("Nowhere", function (u, done) {
  done(new Error("http 503"));
}, function (err, found) {
  failErr = err;
  if (found) {
    throw new Error("fail hit");
  }
});
if (!failErr) {
  throw new Error("fail");
}

var mem = {
  store: {},
  getItem: function (key) {
    return this.store[key] || null;
  },
  setItem: function (key, value) {
    this.store[key] = value;
  }
};
geocode.persist(mem);
geocode.reset();
if (geocode.fromCache("Paris")) {
  throw new Error("reset");
}
geocode.restore(mem);
calls = 0;
var restored = null;
geocode.search("Paris", function () {
  calls++;
}, function (err, found) {
  restored = found;
});
if (calls !== 0 || !restored || restored.name !== "Paris, France") {
  throw new Error("persist");
}

console.log("ok");
