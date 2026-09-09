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

function writeIndexed(indices, w, h) {
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
  var cIDAT = chunk("IDAT", idat);
  var cIEND = chunk("IEND", new Uint8Array(0));
  var out = new Uint8Array(sig.length + cIHDR.length + cPLTE.length + cIDAT.length + cIEND.length);
  var p = 0;
  out.set(sig, p);
  p += sig.length;
  out.set(cIHDR, p);
  p += cIHDR.length;
  out.set(cPLTE, p);
  p += cPLTE.length;
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

module.exports = {
  toPebblePng: toPebblePng
};
