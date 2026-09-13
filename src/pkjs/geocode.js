var CACHE_KEY = "rainradar-geocode";
var NOMINATIM =
  "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=";

var last = null;

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function searchUrl(query) {
  return NOMINATIM + encodeURIComponent(String(query || "").trim());
}

function parse(json) {
  var row = json && json[0];
  if (!row) {
    return null;
  }
  var lat = parseFloat(row.lat);
  var lon = parseFloat(row.lon);
  if (!isFinite(lat) || !isFinite(lon) || lat < -85 || lat > 85 || lon < -180 || lon > 180) {
    return null;
  }
  return {
    lat: lat,
    lon: lon,
    name: String(row.display_name || row.name || "").trim()
  };
}

function fromCache(query) {
  if (!last || !last.hit) {
    return null;
  }
  var q = norm(query);
  if (!q) {
    return null;
  }
  if (q === last.q || q === norm(last.hit.name)) {
    return last.hit;
  }
  return null;
}

function remember(query, hit) {
  last = { q: norm(query), hit: hit };
}

function reset() {
  last = null;
}

function persist(storage) {
  if (!storage || !storage.setItem || !last) {
    return;
  }
  storage.setItem(CACHE_KEY, JSON.stringify(last));
}

function restore(storage) {
  last = null;
  if (!storage || !storage.getItem) {
    return;
  }
  try {
    var obj = JSON.parse(storage.getItem(CACHE_KEY) || "null");
    if (obj && obj.q && obj.hit && isFinite(obj.hit.lat) && isFinite(obj.hit.lon)) {
      last = obj;
    }
  } catch (e) {}
}

// ponytail: first Nominatim hit, a picker if homonyms become a problem
function search(query, getJson, done) {
  query = String(query || "").trim();
  if (!query) {
    done(null, null);
    return;
  }
  var cached = fromCache(query);
  if (cached) {
    done(null, cached);
    return;
  }
  if (!getJson) {
    done(null, null);
    return;
  }
  getJson(searchUrl(query), function (err, json) {
    if (err) {
      done(err, null);
      return;
    }
    var hit = parse(json);
    if (hit) {
      remember(query, hit);
    }
    done(null, hit);
  });
}

module.exports = {
  CACHE_KEY: CACHE_KEY,
  searchUrl: searchUrl,
  parse: parse,
  fromCache: fromCache,
  search: search,
  remember: remember,
  reset: reset,
  persist: persist,
  restore: restore
};
