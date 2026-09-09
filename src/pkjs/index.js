var catalog = require("./catalog");
var png = require("./png");
var keys = require("message_keys");

var CHUNK = 1000;
var DEBUG_LAT = 51.5074;
var DEBUG_LON = -0.1278;
var LIBRE = "https://api.librewxr.net/public/weather-maps.json";
var RAINVIEWER = "https://api.rainviewer.com/public/weather-maps.json";

var state = {
  lat: DEBUG_LAT,
  lon: DEBUG_LON,
  catalog: null,
  zoom: 8,
  cache: {},
  inflight: 0,
  want: null
};

function send(dict, ok, fail) {
  Pebble.sendAppMessage(dict, ok || function () {}, fail || function () {});
}

function xhr(url, type, done) {
  var req = new XMLHttpRequest();
  req.open("GET", url, true);
  req.responseType = type;
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
  jsonGet(LIBRE, function (err, json) {
    if (!err) {
      try {
        var cat = catalog.parseCatalog(json, state.lat, state.lon);
        state.zoom = 8;
        done(null, cat);
        return;
      } catch (e) {
        err = e;
      }
    }
    jsonGet(RAINVIEWER, function (err2, json2) {
      if (err2) {
        done(err2 || err);
        return;
      }
      try {
        state.zoom = 7;
        done(null, catalog.parseCatalog(json2, state.lat, state.lon));
      } catch (e2) {
        done(e2);
      }
    });
  });
}

function toArray(u8) {
  var a = [];
  var i;
  for (i = 0; i < u8.length; i++) {
    a.push(u8[i]);
  }
  return a;
}

function sendChunks(bytes, meta, gen) {
  var arr = toArray(bytes);
  var index = 0;
  function next() {
    if (gen !== state.inflight) {
      return;
    }
    if (index >= arr.length) {
      var done = {};
      done[keys.Complete] = 1;
      done[keys.RequestId] = gen;
      done[keys.Slot] = meta.cursor;
      done[keys.FrameTime] = meta.frameTime;
      send(done);
      return;
    }
    var n = Math.min(CHUNK, arr.length - index);
    var dict = {};
    dict[keys.DataChunk] = arr.slice(index, index + n);
    dict[keys.ChunkSize] = n;
    dict[keys.Index] = index;
    dict[keys.RequestId] = gen;
    send(dict, function () {
      index += n;
      next();
    }, function () {
      if (gen === state.inflight) {
        setTimeout(next, 400);
      }
    });
  }
  var start = {};
  start[keys.DataLength] = arr.length;
  start[keys.RequestId] = gen;
  start[keys.Slot] = meta.cursor;
  start[keys.FrameTime] = meta.frameTime;
  send(start, next, function () {
    if (gen === state.inflight) {
      setTimeout(function () {
        sendChunks(bytes, meta, gen);
      }, 400);
    }
  });
}

function serve(cursor, gen) {
  if (!state.catalog) {
    return;
  }
  if (gen !== state.inflight) {
    return;
  }
  var frame = catalog.pickFrame(state.catalog, cursor);
  if (!frame) {
    var gap = {};
    gap[keys.Status] = 3;
    gap[keys.RequestId] = gen;
    gap[keys.Slot] = cursor;
    send(gap);
    return;
  }
  var cacheKey = frame.time + ":" + state.lat.toFixed(3) + ":" + state.lon.toFixed(3);
  if (state.cache[cacheKey]) {
    sendChunks(state.cache[cacheKey], { cursor: cursor, frameTime: frame.time }, gen);
    prefetch(cursor);
    return;
  }
  var url = catalog.tileUrl(state.catalog, frame, state.zoom);
  xhr(url, "arraybuffer", function (err, buf) {
    if (gen !== state.inflight) {
      return;
    }
    if (err) {
      var fail = {};
      fail[keys.Status] = 2;
      fail[keys.RequestId] = gen;
      send(fail);
      return;
    }
    try {
      var pebblePng = png.toPebblePng(bufOf(buf), 200, 200);
      state.cache[cacheKey] = pebblePng;
      sendChunks(pebblePng, { cursor: cursor, frameTime: frame.time }, gen);
      prefetch(cursor);
    } catch (e) {
      var bad = {};
      bad[keys.Status] = 2;
      bad[keys.RequestId] = gen;
      send(bad);
    }
  });
}

function bufOf(buf) {
  if (buf instanceof Uint8Array) {
    return buf;
  }
  return new Uint8Array(buf);
}

function prefetch(cursor) {
  var neighbors = [cursor - 1, cursor + 1];
  var i;
  for (i = 0; i < neighbors.length; i++) {
    var c = neighbors[i];
    if (c < 0 || c > 8) {
      continue;
    }
    var frame = catalog.pickFrame(state.catalog, c);
    if (!frame) {
      continue;
    }
    var key = frame.time + ":" + state.lat.toFixed(3) + ":" + state.lon.toFixed(3);
    if (state.cache[cacheKeyName(frame)]) {
      continue;
    }
    (function (fr, k) {
      if (state.cache[k]) {
        return;
      }
      xhr(catalog.tileUrl(state.catalog, fr, state.zoom), "arraybuffer", function (err, buf) {
        if (err) {
          return;
        }
        try {
          state.cache[k] = png.toPebblePng(bufOf(buf), 200, 200);
        } catch (e) {}
      });
    })(frame, key);
  }
}

function cacheKeyName(frame) {
  return frame.time + ":" + state.lat.toFixed(3) + ":" + state.lon.toFixed(3);
}

function locate(done) {
  if (!navigator.geolocation) {
    done();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      state.lat = pos.coords.latitude;
      state.lon = pos.coords.longitude;
      done();
    },
    function () {
      done();
    },
    { timeout: 8000, maximumAge: 60000 }
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
      hello[keys.Origin] = cat.origin;
      hello[keys.HasNowcast] = catalog.pickFrame(cat, 8) ? 1 : 0;
      send(hello);
      if (state.want) {
        serve(state.want.cursor, state.want.gen);
      }
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
