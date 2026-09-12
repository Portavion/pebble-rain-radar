var pako = require("pako");

var PEBBLE_LEVELS = [0x00, 0x55, 0xAA, 0xFF];
var PALETTE = (function () {
  var out = [];
  var r, g, b;
  for (r = 0; r < 4; r++) {
    for (g = 0; g < 4; g++) {
      for (b = 0; b < 4; b++) {
        out.push(PEBBLE_LEVELS[r], PEBBLE_LEVELS[g], PEBBLE_LEVELS[b]);
      }
    }
  }
  return out;
})();

function pebbleChannel(v) {
  var best = PEBBLE_LEVELS[0];
  var bestD = Math.abs(v - best);
  var i;
  for (i = 1; i < 4; i++) {
    var d = Math.abs(v - PEBBLE_LEVELS[i]);
    if (d < bestD) {
      best = PEBBLE_LEVELS[i];
      bestD = d;
    }
  }
  return best;
}

function palIndex(r, g, b, a) {
  if (a < 16) {
    return 0;
  }
  var pr = pebbleChannel(r);
  var pg = pebbleChannel(g);
  var pb = pebbleChannel(b);
  return (
    (PEBBLE_LEVELS.indexOf(pr) << 4) |
    (PEBBLE_LEVELS.indexOf(pg) << 2) |
    PEBBLE_LEVELS.indexOf(pb)
  );
}

function u32(u8, o) {
  return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
}

function putU32(u8, o, v) {
  u8[o] = (v >>> 24) & 255;
  u8[o + 1] = (v >>> 16) & 255;
  u8[o + 2] = (v >>> 8) & 255;
  u8[o + 3] = v & 255;
}

function crc32(u8) {
  var c = 0xffffffff;
  var i, k;
  for (i = 0; i < u8.length; i++) {
    c ^= u8[i];
    for (k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  var p = a + b - c;
  var pa = Math.abs(p - a);
  var pb = Math.abs(p - b);
  var pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

function readPng(bytes) {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error("png");
  }
  var off = 8;
  var width = 0;
  var height = 0;
  var bit = 0;
  var color = 0;
  var idatParts = [];
  var plte = null;
  while (off + 12 <= bytes.length) {
    var ln = u32(bytes, off);
    var typ = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    var chunk = bytes.subarray(off + 8, off + 8 + ln);
    if (typ === "IHDR") {
      width = u32(chunk, 0);
      height = u32(chunk, 4);
      bit = chunk[8];
      color = chunk[9];
      if (bit !== 8 || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) {
        throw new Error("png ihdr");
      }
    } else if (typ === "PLTE") {
      plte = chunk;
    } else if (typ === "IDAT") {
      idatParts.push(chunk);
    } else if (typ === "IEND") {
      break;
    }
    off += 12 + ln;
  }
  var idatLen = 0;
  var i;
  for (i = 0; i < idatParts.length; i++) {
    idatLen += idatParts[i].length;
  }
  var idat = new Uint8Array(idatLen);
  var pos = 0;
  for (i = 0; i < idatParts.length; i++) {
    idat.set(idatParts[i], pos);
    pos += idatParts[i].length;
  }
  var raw = pako.inflate(idat);
  var bpp = color === 6 ? 4 : color === 2 ? 3 : 1;
  var stride = width * bpp;
  var rgba = new Uint8Array(width * height * 4);
  var prev = new Uint8Array(stride);
  var ri = 0;
  var y;
  for (y = 0; y < height; y++) {
    var filt = raw[ri];
    var scan = raw.subarray(ri + 1, ri + 1 + stride);
    var row = new Uint8Array(stride);
    row.set(scan);
    var x;
    if (filt === 1) {
      for (x = 0; x < stride; x++) {
        row[x] = (row[x] + (x >= bpp ? row[x - bpp] : 0)) & 255;
      }
    } else if (filt === 2) {
      for (x = 0; x < stride; x++) {
        row[x] = (row[x] + prev[x]) & 255;
      }
    } else if (filt === 3) {
      for (x = 0; x < stride; x++) {
        row[x] = (row[x] + (((x >= bpp ? row[x - bpp] : 0) + prev[x]) >> 1)) & 255;
      }
    } else if (filt === 4) {
      for (x = 0; x < stride; x++) {
        row[x] = (row[x] + paeth(x >= bpp ? row[x - bpp] : 0, prev[x], x >= bpp ? prev[x - bpp] : 0)) & 255;
      }
    } else if (filt !== 0) {
      throw new Error("png filter");
    }
    prev = row;
    ri += 1 + stride;
    for (x = 0; x < width; x++) {
      var o = (y * width + x) * 4;
      if (color === 6) {
        rgba[o] = row[x * 4];
        rgba[o + 1] = row[x * 4 + 1];
        rgba[o + 2] = row[x * 4 + 2];
        rgba[o + 3] = row[x * 4 + 3];
      } else if (color === 2) {
        rgba[o] = row[x * 3];
        rgba[o + 1] = row[x * 3 + 1];
        rgba[o + 2] = row[x * 3 + 2];
        rgba[o + 3] = 255;
      } else {
        var pal = row[x] * 3;
        rgba[o] = plte[pal];
        rgba[o + 1] = plte[pal + 1];
        rgba[o + 2] = plte[pal + 2];
        rgba[o + 3] = 255;
      }
    }
  }
  return { width: width, height: height, rgba: rgba };
}

function scaleNearest(rgba, w, h, nw, nh) {
  var out = new Uint8Array(nw * nh * 4);
  var y, x;
  for (y = 0; y < nh; y++) {
    var sy = Math.floor((y * h) / nh);
    for (x = 0; x < nw; x++) {
      var sx = Math.floor((x * w) / nw);
      var o = (y * nw + x) * 4;
      var s = (sy * w + sx) * 4;
      out[o] = rgba[s];
      out[o + 1] = rgba[s + 1];
      out[o + 2] = rgba[s + 2];
      out[o + 3] = rgba[s + 3];
    }
  }
  return out;
}

function toIndexed(rgba, w, h) {
  var out = new Uint8Array(w * h);
  var i;
  for (i = 0; i < w * h; i++) {
    var o = i * 4;
    out[i] = palIndex(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]);
  }
  return out;
}

function chunk(typ, data) {
  var t = [];
  var i;
  for (i = 0; i < 4; i++) {
    t.push(typ.charCodeAt(i));
  }
  var body = new Uint8Array(4 + data.length);
  body.set(t, 0);
  body.set(data, 4);
  var crc = crc32(body);
  var out = new Uint8Array(12 + data.length);
  putU32(out, 0, data.length);
  out.set(body, 4);
  putU32(out, 8 + data.length, crc);
  return out;
}

function writeIndexed(indices, w, h, transparent) {
  var raw = new Uint8Array(h * (1 + w));
  var y;
  for (y = 0; y < h; y++) {
    raw[y * (1 + w)] = 0;
    raw.set(indices.subarray(y * w, (y + 1) * w), y * (1 + w) + 1);
  }
  var ihdr = new Uint8Array(13);
  putU32(ihdr, 0, w);
  putU32(ihdr, 4, h);
  ihdr[8] = 8;
  ihdr[9] = 3;
  var pal = new Uint8Array(PALETTE);
  var idat = pako.deflate(raw, { level: 9 });
  var sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  var cIHDR = chunk("IHDR", ihdr);
  var cPLTE = chunk("PLTE", pal);
  var cTRNS = transparent ? chunk("tRNS", new Uint8Array([0])) : null;
  var cIDAT = chunk("IDAT", idat);
  var cIEND = chunk("IEND", new Uint8Array(0));
  var extra = cTRNS ? cTRNS.length : 0;
  var out = new Uint8Array(sig.length + cIHDR.length + cPLTE.length + extra + cIDAT.length + cIEND.length);
  var p = 0;
  out.set(sig, p);
  p += sig.length;
  out.set(cIHDR, p);
  p += cIHDR.length;
  out.set(cPLTE, p);
  p += cPLTE.length;
  if (cTRNS) {
    out.set(cTRNS, p);
    p += cTRNS.length;
  }
  out.set(cIDAT, p);
  p += cIDAT.length;
  out.set(cIEND, p);
  return out;
}

function toPebblePng(srcBytes, nw, nh) {
  nw = nw || 200;
  nh = nh || 200;
  var decoded = readPng(bytesOf(srcBytes));
  var scaled = scaleNearest(decoded.rgba, decoded.width, decoded.height, nw, nh);
  var idx = toIndexed(scaled, nw, nh);
  return writeIndexed(idx, nw, nh);
}

function bytesOf(src) {
  if (src instanceof Uint8Array) {
    return src;
  }
  if (src instanceof ArrayBuffer) {
    return new Uint8Array(src);
  }
  return new Uint8Array(src);
}

function lonToX(lon, z) {
  return ((lon + 180) / 360) * (1 << z) * 256;
}

function latToY(lat, z) {
  var s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * (1 << z) * 256;
}

function mapView(lat, lon, z, size) {
  size = size || 256;
  var left = Math.floor(lonToX(lon, z) - size / 2);
  var top = Math.floor(latToY(lat, z) - size / 2);
  var max = 1 << z;
  var x0 = Math.floor(left / 256);
  var y0 = Math.floor(top / 256);
  var x1 = Math.floor((left + size - 1) / 256);
  var y1 = Math.floor((top + size - 1) / 256);
  var tiles = [];
  var x;
  var y;
  for (y = y0; y <= y1; y++) {
    if (y < 0 || y >= max) {
      continue;
    }
    for (x = x0; x <= x1; x++) {
      tiles.push({
        z: z,
        x: ((x % max) + max) % max,
        y: y,
        originX: x,
        originY: y
      });
    }
  }
  return { left: left, top: top, size: size, tiles: tiles, z: z };
}

function solidRgba(size, r, g, b) {
  var n = size * size;
  var out = new Uint8Array(n * 4);
  var i;
  for (i = 0; i < n; i++) {
    var o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return out;
}

function blitTile(dst, view, tile, rgba, tw) {
  tw = tw || 256;
  var size = view.size;
  var tx = tile.originX * 256;
  var ty = tile.originY * 256;
  var y;
  var x;
  for (y = 0; y < size; y++) {
    var sy = view.top + y - ty;
    if (sy < 0 || sy >= tw) {
      continue;
    }
    for (x = 0; x < size; x++) {
      var sx = view.left + x - tx;
      if (sx < 0 || sx >= tw) {
        continue;
      }
      var di = (y * size + x) * 4;
      var si = (sy * tw + sx) * 4;
      dst[di] = rgba[si];
      dst[di + 1] = rgba[si + 1];
      dst[di + 2] = rgba[si + 2];
      dst[di + 3] = 255;
    }
  }
}

function assembleMap(view, parts) {
  var dst = solidRgba(view.size, 0xaa, 0xaa, 0xaa);
  var i;
  for (i = 0; i < view.tiles.length; i++) {
    if (!parts[i] || !parts[i].rgba) {
      continue;
    }
    blitTile(dst, view, view.tiles[i], parts[i].rgba, parts[i].width);
  }
  return dst;
}

var MAP_LAND = [255, 255, 255];
var MAP_WATER = [170, 170, 170];
var RAIN = [
  [170, 255, 255],
  [0, 170, 255],
  [0, 85, 170],
  [255, 255, 0],
  [255, 170, 0],
  [170, 0, 0]
];
var BLUE_KEYS = [
  [130, 123, 105, 0],
  [146, 136, 113, 5],
  [206, 192, 135, 10],
  [136, 221, 238, 15],
  [0, 163, 224, 20],
  [0, 119, 170, 25],
  [0, 85, 136, 30],
  [255, 238, 0, 35],
  [255, 170, 0, 40],
  [255, 68, 0, 45],
  [193, 0, 0, 50],
  [255, 170, 255, 55]
];

function lum(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function isBlue(r, g, b) {
  return b > r + 8 && b >= g - 4 && (b > 110 || b > r + 16);
}

function isRoad(r, g, b) {
  var L = lum(r, g, b);
  var c = Math.max(r, g, b) - Math.min(r, g, b);
  if (L >= 214 || isBlue(r, g, b)) {
    return false;
  }
  if (r > g + 8 && r > b + 8) {
    return true;
  }
  return c > 18 && L > 90 && L < 210 && r >= g;
}

function styleMap(rgba) {
  var i;
  for (i = 0; i < rgba.length; i += 4) {
    var r = rgba[i];
    var g = rgba[i + 1];
    var b = rgba[i + 2];
    if (isBlue(r, g, b)) {
      rgba[i] = MAP_WATER[0];
      rgba[i + 1] = MAP_WATER[1];
      rgba[i + 2] = MAP_WATER[2];
    } else if (!isRoad(r, g, b) && lum(r, g, b) >= 200) {
      rgba[i] = MAP_LAND[0];
      rgba[i + 1] = MAP_LAND[1];
      rgba[i + 2] = MAP_LAND[2];
    }
    rgba[i + 3] = 255;
  }
  return rgba;
}

function rainColor(r, g, b, a) {
  if (a < 48) {
    return null;
  }
  var best = 0;
  var bestD = 1e9;
  var i;
  for (i = 0; i < BLUE_KEYS.length; i++) {
    var k = BLUE_KEYS[i];
    var d = (r - k[0]) * (r - k[0]) + (g - k[1]) * (g - k[1]) + (b - k[2]) * (b - k[2]);
    if (d < bestD) {
      bestD = d;
      best = k[3];
    }
  }
  if (best < 15) {
    return null;
  }
  if (best < 20) {
    return RAIN[0];
  }
  if (best < 30) {
    return RAIN[1];
  }
  if (best < 35) {
    return RAIN[2];
  }
  if (best < 40) {
    return RAIN[3];
  }
  if (best < 50) {
    return RAIN[4];
  }
  return RAIN[5];
}

function washRadar(rgba) {
  var i;
  for (i = 0; i < rgba.length; i += 4) {
    var c = rainColor(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
    if (c) {
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
    } else {
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
    }
    rgba[i + 3] = 255;
  }
  return rgba;
}

function overlay(mapRgba, radarRgba, pixels) {
  var out = new Uint8Array(pixels * 4);
  out.set(mapRgba);
  var i;
  for (i = 0; i < pixels; i++) {
    var o = i * 4;
    var c = rainColor(radarRgba[o], radarRgba[o + 1], radarRgba[o + 2], radarRgba[o + 3]);
    if (!c) {
      continue;
    }
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 255;
  }
  return out;
}

function rgbaToPebblePng(rgba, w, h, nw, nh, transparent) {
  nw = nw || 200;
  nh = nh || 200;
  var scaled = w === nw && h === nh ? rgba : scaleNearest(rgba, w, h, nw, nh);
  return writeIndexed(toIndexed(scaled, nw, nh), nw, nh, transparent);
}

function rainOnlyPng(radar, nw, nh) {
  var rgba = radar.rgba;
  var i;
  for (i = 0; i < rgba.length; i += 4) {
    var c = rainColor(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
    if (c) {
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    } else {
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
  }
  return rgbaToPebblePng(rgba, radar.width, radar.height, nw, nh, false);
}

function mapToPebblePng(mapRgba, mapSize, nw, nh) {
  return rgbaToPebblePng(mapRgba, mapSize, mapSize, nw, nh, false);
}

function compose(mapRgba, mapSize, radar, nw, nh) {
  var radarRgba = radar.rgba;
  if (radar.width !== mapSize || radar.height !== mapSize) {
    radarRgba = scaleNearest(radar.rgba, radar.width, radar.height, mapSize, mapSize);
  }
  return rgbaToPebblePng(overlay(mapRgba, radarRgba, mapSize * mapSize), mapSize, mapSize, nw, nh);
}

function fitRadarToViewZoom(radar, viewZoom, tileZoom) {
  var zoomSteps = viewZoom - tileZoom;
  var scale;
  var tilePx;
  var cropPx;
  var cropOrigin;
  var cropped;
  var y;
  var x;
  if (zoomSteps <= 0) {
    return radar;
  }
  scale = 1 << zoomSteps;
  tilePx = radar.width;
  cropPx = (tilePx / scale) | 0;
  cropOrigin = ((tilePx - cropPx) / 2) | 0;
  cropped = new Uint8Array(cropPx * cropPx * 4);
  for (y = 0; y < cropPx; y++) {
    for (x = 0; x < cropPx; x++) {
      var di = (y * cropPx + x) * 4;
      var si = ((cropOrigin + y) * tilePx + (cropOrigin + x)) * 4;
      cropped[di] = radar.rgba[si];
      cropped[di + 1] = radar.rgba[si + 1];
      cropped[di + 2] = radar.rgba[si + 2];
      cropped[di + 3] = radar.rgba[si + 3];
    }
  }
  return {
    width: tilePx,
    height: tilePx,
    rgba: scaleNearest(cropped, cropPx, cropPx, tilePx, tilePx)
  };
}

function composeFrame(mapRgba, mapSize, radar, nw, nh, view, tileZoom, viewZoom) {
  viewZoom = viewZoom == null ? 9 : viewZoom;
  tileZoom = tileZoom == null ? viewZoom : tileZoom;
  return compose(mapRgba, mapSize, fitRadarToViewZoom(radar, viewZoom, tileZoom), nw, nh, view);
}

module.exports = {
  toPebblePng: toPebblePng,
  readPng: readPng,
  mapView: mapView,
  solidRgba: solidRgba,
  assembleMap: assembleMap,
  overlay: overlay,
  rainColor: rainColor,
  scaleNearest: scaleNearest,
  compose: compose,
  composeFrame: composeFrame,
  styleMap: styleMap,
  washRadar: washRadar,
  rainOnlyPng: rainOnlyPng,
  mapToPebblePng: mapToPebblePng,
  rgbaToPebblePng: rgbaToPebblePng,
  blitTile: blitTile
};
