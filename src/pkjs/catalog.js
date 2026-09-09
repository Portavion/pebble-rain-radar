var OFFSETS = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
var NOW = 4;
var MATCH_SLACK = 8 * 60;

function parseCatalog(json, lat, lon) {
  if (!json || !json.host || !json.radar) {
    throw new Error("catalog");
  }
  var past = json.radar.past || [];
  var nowcast = json.radar.nowcast || [];
  var frames = [];
  var i;
  for (i = 0; i < past.length; i++) {
    if (past[i] && typeof past[i].time === "number" && typeof past[i].path === "string") {
      frames.push({ time: past[i].time, path: past[i].path, kind: "past" });
    }
  }
  for (i = 0; i < nowcast.length; i++) {
    if (nowcast[i] && typeof nowcast[i].time === "number" && typeof nowcast[i].path === "string") {
      frames.push({ time: nowcast[i].time, path: nowcast[i].path, kind: "nowcast" });
    }
  }
  if (!frames.length) {
    throw new Error("catalog empty");
  }
  var origin = 0;
  for (i = 0; i < frames.length; i++) {
    if (frames[i].kind === "past" && frames[i].time > origin) {
      origin = frames[i].time;
    }
  }
  if (!origin) {
    throw new Error("no past");
  }
  return {
    host: String(json.host).replace(/\/$/, ""),
    lat: lat,
    lon: lon,
    origin: origin,
    frames: frames
  };
}

function poolForCursor(catalog, cursor) {
  var want = cursor <= NOW ? "past" : "nowcast";
  var pool = [];
  var i;
  for (i = 0; i < catalog.frames.length; i++) {
    if (catalog.frames[i].kind === want) {
      pool.push(catalog.frames[i]);
    }
  }
  return pool;
}

function nearestInPool(pool, target, origin) {
  if (!pool.length) {
    return null;
  }
  var best = pool[0];
  var bestAbs = Math.abs(best.time - target);
  var bestOrigin = Math.abs(best.time - origin);
  var i;
  for (i = 1; i < pool.length; i++) {
    var t = pool[i].time;
    var a = Math.abs(t - target);
    var o = Math.abs(t - origin);
    if (a < bestAbs || (a === bestAbs && o < bestOrigin)) {
      best = pool[i];
      bestAbs = a;
      bestOrigin = o;
    }
  }
  if (bestAbs > MATCH_SLACK) {
    return null;
  }
  return best;
}

function pickFrame(catalog, cursor) {
  if (cursor === NOW) {
    var i;
    for (i = 0; i < catalog.frames.length; i++) {
      if (catalog.frames[i].kind === "past" && catalog.frames[i].time === catalog.origin) {
        return catalog.frames[i];
      }
    }
    return null;
  }
  var target = catalog.origin + OFFSETS[cursor] * 60;
  return nearestInPool(poolForCursor(catalog, cursor), target, catalog.origin);
}

function tileUrl(catalog, frame, zoom) {
  var z = zoom == null ? 8 : zoom;
  return (
    catalog.host +
    frame.path +
    "/256/" +
    z +
    "/" +
    catalog.lat.toFixed(4) +
    "/" +
    catalog.lon.toFixed(4) +
    "/2/1_0.png"
  );
}

function timelineSlots(catalog) {
  var slots = [];
  var i;
  for (i = 0; i < OFFSETS.length; i++) {
    var frame = pickFrame(catalog, i);
    slots.push({
      index: i,
      offsetMin: OFFSETS[i],
      frameTime: frame ? frame.time : null
    });
  }
  return slots;
}

module.exports = {
  OFFSETS: OFFSETS,
  NOW: NOW,
  MATCH_SLACK: MATCH_SLACK,
  parseCatalog: parseCatalog,
  pickFrame: pickFrame,
  tileUrl: tileUrl,
  timelineSlots: timelineSlots
};
