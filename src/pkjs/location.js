var DEFAULT_LAT = 51.5074;
var DEFAULT_LON = -0.1278;
var STORAGE_KEY = "clay-settings";

function num(value, fallback) {
  var n = parseFloat(value);
  return isFinite(n) ? n : fallback;
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
    lon: lon
  };
}

function fromStorage(storage) {
  if (!storage || !storage.getItem) {
    return load(null);
  }
  try {
    return load(JSON.parse(storage.getItem(STORAGE_KEY) || "null"));
  } catch (e) {
    return load(null);
  }
}

module.exports = {
  DEFAULT_LAT: DEFAULT_LAT,
  DEFAULT_LON: DEFAULT_LON,
  STORAGE_KEY: STORAGE_KEY,
  load: load,
  fromStorage: fromStorage
};
