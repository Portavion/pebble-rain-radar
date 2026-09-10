var catalog = require("./catalog");
var png = require("./png");
var keys = require("message_keys");

var CHUNK = 4000;
var DEBUG_LAT = 51.5074;
var DEBUG_LON = -0.1278;
var LIBRE = "https://api.librewxr.net/public/weather-maps.json";
var RAINVIEWER = "https://api.rainviewer.com/public/weather-maps.json";

var state = {
  view: { lat: DEBUG_LAT, lon: DEBUG_LON, zoom: catalog.VIEW_ZOOM },
  catalog: null,
  cache: {},
  inflight: 0,
  want: null,
  mapRgba: null,
  mapView: null,
  mapWait: null,
  rvCatalog: null,
  libreCatalog: null,
  sendQ: [],
  sendBusy: false,
  warmQ: [],
  warming: false
};

function send(dict, ok, fail) {
  Pebble.sendAppMessage(dict, ok || function () {}, fail || function () {});
}

function xhr(url, type, done, osm) {
  var req = new XMLHttpRequest();
  req.open("GET", url, true);
  req.responseType = type;
  req.timeout = osm ? 8000 : 15000;
  if (osm) {
    try {
      req.setRequestHeader("Accept", "image/png,image/*,*/*;q=0.8");
      req.setRequestHeader("Referer", "https://www.openstreetmap.org/");
    } catch (e) {}
  }
  try {
    req.setRequestHeader("User-Agent", "Rainradar/1.0");
  } catch (e) {}
  req.onload = function () {
    if (req.status >= 200 && req.status < 300) {
      done(null, req.response);
    } else {
      done(new Error("http " + req.status));
    }
  };
  req.onerror = function () {
    done(new Error("net"));
  };
  req.ontimeout = function () {
    done(new Error("timeout"));
  };
  req.send();
}

function jsonGet(url, done) {
  xhr(url, "text", function (err, text) {
    if (err) {
      done(err);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (e) {
      done(e);
    }
  });
}

function loadCatalog(done) {
  var settled = false;
  function use(json) {
    if (settled || !json) {
      return;
    }
    try {
      var cat = catalog.parseCatalog(json, state.view.lat, state.view.lon);
      settled = true;
      done(null, cat);
    } catch (e) {}
  }
  jsonGet(RAINVIEWER, function (err, json) {
    if (err) {
      return;
    }
    try {
      state.rvCatalog = catalog.parseCatalog(json, state.view.lat, state.view.lon);
    } catch (e) {}
    use(json);
  });
  jsonGet(LIBRE, function (err, json) {
    if (err) {
      return;
    }
    try {
      state.libreCatalog = catalog.parseCatalog(json, state.view.lat, state.view.lon);
    } catch (e) {}
    if (!settled) {
      use(json);
    } else if (state.catalog && state.want) {
      prefetch(state.want.cursor);
    }
  });
  setTimeout(function () {
    if (!settled) {
      settled = true;
      done(new Error("catalog"));
    }
  }, 10000);
}

function toArray(u8) {
  var a = [];
  var i;
  for (i = 0; i < u8.length; i++) {
    a.push(u8[i]);
  }
  return a;
}

function sendChunks(bytes, meta, gen, done) {
  var arr = toArray(bytes);
  var index = 0;
  function finish() {
    if (done) {
      done();
    }
  }
  function live() {
    return gen === 0 || gen === state.inflight;
  }
  function next() {
    if (!live()) {
      finish();
      return;
    }
    if (index >= arr.length) {
      var complete = {};
      complete[keys.Complete] = 1;
      complete[keys.RequestId] = gen;
      complete[keys.Slot] = meta.cursor;
      complete[keys.FrameTime] = meta.frameTime;
      send(complete, finish, finish);
      return;
    }
    var take = Math.min(CHUNK, arr.length - index);
    var dict = {};
    dict[keys.DataChunk] = arr.slice(index, index + take);
    dict[keys.ChunkSize] = take;
    dict[keys.Index] = index;
    dict[keys.RequestId] = gen;
    dict[keys.Slot] = meta.cursor;
    send(dict, function () {
      index += take;
      next();
    }, function () {
      if (live()) {
        setTimeout(next, 400);
      } else {
        finish();
      }
    });
  }
  var start = {};
  start[keys.DataLength] = arr.length;
  start[keys.RequestId] = gen;
  start[keys.Slot] = meta.cursor;
  start[keys.FrameTime] = meta.frameTime;
  if (state.catalog) {
    start[keys.Origin] = (state.rvCatalog || state.catalog).origin;
  }
  send(start, next, function () {
    if (live()) {
      setTimeout(function () {
        sendChunks(bytes, meta, gen, done);
      }, 400);
    } else {
      finish();
    }
  });
}

function pumpSend() {
  if (state.sendBusy) {
    return;
  }
  var job = state.sendQ.shift();
  if (!job) {
    return;
  }
  if (job.gen !== 0 && job.gen !== state.inflight) {
    pumpSend();
    return;
  }
  state.sendBusy = true;
  sendChunks(job.bytes, job.meta, job.gen, function () {
    state.sendBusy = false;
    pumpSend();
  });
}

function enqueueSend(bytes, meta, gen) {
  var job = { bytes: bytes, meta: meta, gen: gen };
  if (gen !== 0 && gen === state.inflight) {
    state.sendQ.unshift(job);
  } else {
    state.sendQ.push(job);
  }
  pumpSend();
}

function mapTileUrl(host, t) {
  if (host === "fr") {
    return "https://a.tile.openstreetmap.fr/osmfr/" + t.z + "/" + t.x + "/" + t.y + ".png";
  }
  if (host === "de") {
    return "https://tile.openstreetmap.de/" + t.z + "/" + t.x + "/" + t.y + ".png";
  }
  return "https://tile.openstreetmap.org/" + t.z + "/" + t.x + "/" + t.y + ".png";
}

function fetchMap(done) {
  var view = png.mapView(state.view.lat, state.view.lon, state.view.zoom, 256);
  if (!view.tiles.length) {
    done(new Error("map"));
    return;
  }
  var assembled = png.solidRgba(view.size, 0xaa, 0xaa, 0xaa);
  var hosts = ["de", "fr", "osm"];
  var remaining = view.tiles.length;
  var i;
  function tileDone() {
    remaining--;
    if (remaining > 0) {
      return;
    }
    png.styleMap(assembled);
    done(null, assembled, view);
  }
  function fetchTile(tile) {
    var hi = 0;
    function got(err, buf) {
      if (err && hi + 1 < hosts.length) {
        hi++;
        xhr(mapTileUrl(hosts[hi], tile), "arraybuffer", got, hosts[hi] === "osm");
        return;
      }
      if (!err) {
        try {
          var decoded = png.readPng(bufOf(buf));
          png.blitTile(assembled, view, tile, decoded.rgba, decoded.width);
        } catch (e) {}
      }
      tileDone();
    }
    xhr(mapTileUrl(hosts[0], tile), "arraybuffer", got, false);
  }
  for (i = 0; i < view.tiles.length; i++) {
    fetchTile(view.tiles[i]);
  }
}

function ensureMap(done) {
  if (state.mapRgba) {
    done();
    return;
  }
  if (state.mapWait) {
    state.mapWait.push(done);
    return;
  }
  state.mapWait = [done];
  fetchMap(function (err, rgba, view) {
    if (rgba) {
      state.mapRgba = rgba;
      state.mapView = view;
    }
    var cbs = state.mapWait;
    state.mapWait = null;
    var i;
    for (i = 0; i < cbs.length; i++) {
      cbs[i]();
    }
  });
}

function paint(radarBuf, tileZoom) {
  var radar = png.readPng(bufOf(radarBuf));
  if (!state.mapRgba) {
    throw new Error("map");
  }
  var mapSize = Math.round(Math.sqrt(state.mapRgba.length / 4));
  return png.composeFrame(
    state.mapRgba,
    mapSize,
    radar,
    200,
    200,
    state.mapView,
    tileZoom,
    state.view.zoom
  );
}

function sendGap(cursor) {
  var gap = {};
  gap[keys.Status] = 3;
  gap[keys.RequestId] = state.want && state.want.cursor === cursor ? state.inflight : 0;
  gap[keys.Slot] = cursor;
  send(gap);
}

function fetchRadar(picked, done) {
  xhr(catalog.tileUrl(picked.cat, picked.frame, picked.zoom), "arraybuffer", function (err, buf) {
    done(err ? new Error("gap") : null, buf);
  });
}

function cacheKeyName(frame) {
  return frame.time + ":" + state.view.lat.toFixed(3) + ":" + state.view.lon.toFixed(3);
}

function pushSlot(cursor, bytes, frameTime, gen) {
  enqueueSend(bytes, { cursor: cursor, frameTime: frameTime }, gen);
}

function paintSlot(cursor, done) {
  var picked = catalog.pickRadar(state.rvCatalog, state.libreCatalog, cursor);
  var key = picked ? cacheKeyName(picked.frame) : null;
  var radarBuf = null;
  var radarErr = picked ? null : new Error("gap");
  var fromCache = false;
  var pending = 2;
  function finish() {
    pending--;
    if (pending) {
      return;
    }
    var gen = state.want && state.want.cursor === cursor ? state.inflight : 0;
    if (!state.mapRgba || radarErr || (!fromCache && !radarBuf)) {
      sendGap(cursor);
      done();
      return;
    }
    if (fromCache) {
      pushSlot(cursor, state.cache[key], picked.frame.time, gen);
      done();
      return;
    }
    try {
      state.cache[key] = paint(radarBuf, picked.zoom);
      pushSlot(cursor, state.cache[key], picked.frame.time, gen);
    } catch (e) {
      sendGap(cursor);
    }
    done();
  }
  ensureMap(finish);
  if (!picked) {
    finish();
    return;
  }
  if (state.cache[key]) {
    fromCache = true;
    finish();
    return;
  }
  fetchRadar(picked, function (err, buf) {
    radarErr = err;
    radarBuf = buf;
    finish();
  });
}

function pumpWarm() {
  if (state.warming) {
    return;
  }
  var cursor = state.warmQ.shift();
  if (cursor === undefined) {
    return;
  }
  state.warming = true;
  paintSlot(cursor, function () {
    state.warming = false;
    pumpWarm();
  });
}

function prefetch(cursor) {
  var set = catalog.warmSet(cursor);
  var i;
  for (i = 0; i < set.length; i++) {
    if (set[i] !== cursor) {
      state.warmQ.push(set[i]);
    }
  }
  pumpWarm();
}

function serve(cursor, gen) {
  if (!state.catalog) {
    return;
  }
  if (gen !== state.inflight) {
    return;
  }
  paintSlot(cursor, function () {
    prefetch(cursor);
  });
}

function bufOf(buf) {
  if (buf instanceof Uint8Array) {
    return buf;
  }
  return new Uint8Array(buf);
}

function locate(done) {
  if (!navigator.geolocation) {
    done();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      state.view.lat = pos.coords.latitude;
      state.view.lon = pos.coords.longitude;
      done();
    },
    function () {
      done();
    },
    { timeout: 3000, maximumAge: 60000 }
  );
}

function boot() {
  locate(function () {
    loadCatalog(function (err, cat) {
      if (err) {
        var dict = {};
        dict[keys.Status] = 2;
        send(dict);
        return;
      }
      state.catalog = cat;
      var hello = {};
      hello[keys.Status] = 0;
      hello[keys.Origin] = (state.rvCatalog || cat).origin;
      hello[keys.HasNowcast] = catalog.pickRadar(state.rvCatalog, state.libreCatalog, 8) ||
        catalog.pickRadar(state.rvCatalog, state.libreCatalog, 5)
        ? 1
        : 0;
      send(hello);
      var cursor = state.want ? state.want.cursor : catalog.NOW;
      var gen = state.want ? state.want.gen : 1;
      state.inflight = gen;
      state.want = { cursor: cursor, gen: gen };
      serve(cursor, gen);
    });
  });
}

Pebble.addEventListener("ready", function () {
  var ready = {};
  ready[keys.JSReady] = 1;
  send(ready);
  boot();
});

Pebble.addEventListener("appmessage", function (e) {
  var payload = e.payload || {};
  if (payload[keys.SlotWanted] === undefined && payload[keys.Slot] === undefined) {
    return;
  }
  var cursor = payload[keys.SlotWanted];
  if (cursor === undefined) {
    cursor = payload[keys.Slot];
  }
  var gen = payload[keys.RequestId] || 1;
  state.inflight = gen;
  state.want = { cursor: cursor, gen: gen };
  if (!state.catalog) {
    return;
  }
  serve(cursor, gen);
});
