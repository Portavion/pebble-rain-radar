var catalog = require("../src/pkjs/catalog");

var now = 1788942000;
var json = {
  host: "https://api.librewxr.net/",
  radar: {
    past: [
      { time: now - 3600, path: "/v2/radar/" + (now - 3600) },
      { time: now - 900, path: "/v2/radar/" + (now - 900) },
      { time: now, path: "/v2/radar/" + now }
    ],
    nowcast: [
      { time: now + 600, path: "/v2/radar/" + (now + 600) },
      { time: now + 3600, path: "/v2/radar/" + (now + 3600) }
    ]
  }
};

var cat = catalog.parseCatalog(json, 51.5074, -0.1278);
if (cat.origin !== now) {
  throw new Error("origin");
}
if (catalog.pickFrame(cat, 4).time !== now) {
  throw new Error("now");
}
if (catalog.pickFrame(cat, 3).time !== now - 900) {
  throw new Error("m15");
}
if (catalog.pickFrame(cat, 5).time !== now + 600) {
  throw new Error("p15");
}
if (catalog.pickFrame(cat, 8).time !== now + 3600) {
  throw new Error("p60");
}

var pastOnly = catalog.parseCatalog(
  {
    host: "https://tilecache.rainviewer.com",
    radar: { past: json.radar.past, nowcast: [] }
  },
  48.8566,
  2.3522
);
if (catalog.pickFrame(pastOnly, 5) !== null) {
  throw new Error("future must gap");
}
if (
  catalog.tileUrl(cat, catalog.pickFrame(cat, 4), 9) !==
  "https://api.librewxr.net/v2/radar/1788942000/256/9/51.5074/-0.1278/2/1_0.png"
) {
  throw new Error("libre url");
}
if (
  catalog.tileUrl(pastOnly, catalog.pickFrame(pastOnly, 4), 7) !==
  "https://tilecache.rainviewer.com/v2/radar/1788942000/256/7/48.8566/2.3522/2/1_0.png"
) {
  throw new Error("rv url");
}
var nowPick = catalog.pickRadar(pastOnly, cat, 4);
if (!nowPick || nowPick.zoom !== 7 || nowPick.frame.time !== now) {
  throw new Error("pick now");
}
var futurePick = catalog.pickRadar(pastOnly, cat, 5);
if (!futurePick || futurePick.zoom !== 9 || futurePick.frame.time !== now + 600) {
  throw new Error("pick future");
}
if (catalog.pickRadar(pastOnly, null, 5) !== null) {
  throw new Error("pick gap");
}
var warm = catalog.warmSet(4);
if (warm.length !== 8 || warm[0] !== 0 || warm[3] !== 3 || warm[4] !== 5 || warm[7] !== 8) {
  throw new Error("warm");
}
console.log("ok");
