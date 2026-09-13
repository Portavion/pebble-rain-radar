var geocode = require("./geocode");

var DEFAULT_LAT = 51.5074;
var DEFAULT_LON = -0.1278;
var STORAGE_KEY = "clay-settings";

function num(value, fallback) {
  var n = parseFloat(value);
  return isFinite(n) ? n : fallback;
}

function cityOf(raw) {
  return String((raw && raw.City) || "").trim();
}

function load(raw) {
  raw = raw || {};
  var lat = num(raw.Lat, DEFAULT_LAT);
  var lon = num(raw.Lon, DEFAULT_LON);
  if (lat < -85 || lat > 85) {
    lat = DEFAULT_LAT;
  }
  if (lon < -180 || lon > 180) {
    lon = DEFAULT_LON;
  }
  return {
    mode: raw.LocMode === "fixed" ? "fixed" : "gps",
    lat: lat,
    lon: lon,
    city: cityOf(raw)
  };
}

function readRaw(storage) {
  if (!storage || !storage.getItem) {
    return {};
  }
  try {
    return JSON.parse(storage.getItem(STORAGE_KEY) || "null") || {};
  } catch (e) {
    return {};
  }
}

function writeRaw(storage, patch) {
  if (!storage || !storage.setItem) {
    return;
  }
  var raw = readRaw(storage);
  var key;
  for (key in patch) {
    raw[key] = patch[key];
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(raw));
}

function fromStorage(storage) {
  return load(readRaw(storage));
}

function resolve(storage, getJson, done) {
  geocode.restore(storage);
  var raw = readRaw(storage);
  var city = cityOf(raw);
  if (!city) {
    done(null, load(raw));
    return;
  }
  var cached = geocode.fromCache(city);
  if (cached) {
    if (raw.City !== cached.name) {
      writeRaw(storage, { City: cached.name });
    }
    done(null, load(readRaw(storage)));
    return;
  }
  geocode.search(city, getJson, function (err, hit) {
    if (hit) {
      writeRaw(storage, {
        LocMode: "fixed",
        Lat: String(hit.lat),
        Lon: String(hit.lon),
        City: hit.name
      });
      geocode.persist(storage);
      done(null, load(readRaw(storage)));
      return;
    }
    done(err || null, load(raw));
  });
}

module.exports = {
  DEFAULT_LAT: DEFAULT_LAT,
  DEFAULT_LON: DEFAULT_LON,
  STORAGE_KEY: STORAGE_KEY,
  load: load,
  fromStorage: fromStorage,
  resolve: resolve
};
