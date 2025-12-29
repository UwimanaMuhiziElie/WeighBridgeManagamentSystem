var Yt = Object.defineProperty;
var Qt = (s, r, t) => r in s ? Yt(s, r, { enumerable: !0, configurable: !0, writable: !0, value: t }) : s[r] = t;
var g = (s, r, t) => Qt(s, typeof r != "symbol" ? r + "" : r, t);
import { app as he, BrowserWindow as St, ipcMain as pe } from "electron";
import $ from "stream";
import Xe from "tty";
import X from "util";
import $t from "os";
import et from "fs";
import Q from "path";
import Xt from "events";
import er from "child_process";
import { fileURLToPath as tr } from "url";
var v = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {}, tt = {}, me = {};
Object.defineProperty(me, "__esModule", { value: !0 });
me.ByteLengthParser = void 0;
const rr = $;
class nr extends rr.Transform {
  constructor(t) {
    super(t);
    g(this, "length");
    g(this, "position");
    g(this, "buffer");
    if (typeof t.length != "number")
      throw new TypeError('"length" is not a number');
    if (t.length < 1)
      throw new TypeError('"length" is not greater than 0');
    this.length = t.length, this.position = 0, this.buffer = Buffer.alloc(this.length);
  }
  _transform(t, e, a) {
    let c = 0;
    for (; c < t.length; )
      this.buffer[this.position] = t[c], c++, this.position++, this.position === this.length && (this.push(this.buffer), this.buffer = Buffer.alloc(this.length), this.position = 0);
    a();
  }
  _flush(t) {
    this.push(this.buffer.slice(0, this.position)), this.buffer = Buffer.alloc(this.length), t();
  }
}
me.ByteLengthParser = nr;
var we = {};
Object.defineProperty(we, "__esModule", { value: !0 });
we.CCTalkParser = void 0;
const ir = $;
class sr extends ir.Transform {
  constructor(t = 50) {
    super();
    g(this, "array");
    g(this, "cursor");
    g(this, "lastByteFetchTime");
    g(this, "maxDelayBetweenBytesMs");
    this.array = [], this.cursor = 0, this.lastByteFetchTime = 0, this.maxDelayBetweenBytesMs = t;
  }
  _transform(t, e, a) {
    if (this.maxDelayBetweenBytesMs > 0) {
      const c = Date.now();
      c - this.lastByteFetchTime > this.maxDelayBetweenBytesMs && (this.array = [], this.cursor = 0), this.lastByteFetchTime = c;
    }
    for (this.cursor += t.length, Array.from(t).map((c) => this.array.push(c)); this.cursor > 1 && this.cursor >= this.array[1] + 5; ) {
      const c = this.array[1] + 5, f = Buffer.from(this.array.slice(0, c));
      this.array = this.array.slice(f.length, this.array.length), this.cursor -= c, this.push(f);
    }
    a();
  }
}
we.CCTalkParser = sr;
var te = {};
Object.defineProperty(te, "__esModule", { value: !0 });
te.DelimiterParser = void 0;
const or = $;
let ar = class extends or.Transform {
  constructor({ delimiter: t, includeDelimiter: e = !1, ...a }) {
    super(a);
    g(this, "includeDelimiter");
    g(this, "delimiter");
    g(this, "buffer");
    if (t === void 0)
      throw new TypeError('"delimiter" is not a bufferable object');
    if (t.length === 0)
      throw new TypeError('"delimiter" has a 0 or undefined length');
    this.includeDelimiter = e, this.delimiter = Buffer.from(t), this.buffer = Buffer.alloc(0);
  }
  _transform(t, e, a) {
    let c = Buffer.concat([this.buffer, t]), f;
    for (; (f = c.indexOf(this.delimiter)) !== -1; )
      this.push(c.slice(0, f + (this.includeDelimiter ? this.delimiter.length : 0))), c = c.slice(f + this.delimiter.length);
    this.buffer = c, a();
  }
  _flush(t) {
    this.push(this.buffer), this.buffer = Buffer.alloc(0), t();
  }
};
te.DelimiterParser = ar;
var ge = {};
Object.defineProperty(ge, "__esModule", { value: !0 });
ge.InterByteTimeoutParser = void 0;
const ur = $;
class cr extends ur.Transform {
  constructor({ maxBufferSize: t = 65536, interval: e, ...a }) {
    super(a);
    g(this, "maxBufferSize");
    g(this, "currentPacket");
    g(this, "interval");
    g(this, "intervalID");
    if (!e)
      throw new TypeError('"interval" is required');
    if (typeof e != "number" || Number.isNaN(e))
      throw new TypeError('"interval" is not a number');
    if (e < 1)
      throw new TypeError('"interval" is not greater than 0');
    if (typeof t != "number" || Number.isNaN(t))
      throw new TypeError('"maxBufferSize" is not a number');
    if (t < 1)
      throw new TypeError('"maxBufferSize" is not greater than 0');
    this.maxBufferSize = t, this.currentPacket = [], this.interval = e;
  }
  _transform(t, e, a) {
    this.intervalID && clearTimeout(this.intervalID);
    for (let c = 0; c < t.length; c++)
      this.currentPacket.push(t[c]), this.currentPacket.length >= this.maxBufferSize && this.emitPacket();
    this.intervalID = setTimeout(this.emitPacket.bind(this), this.interval), a();
  }
  emitPacket() {
    this.intervalID && clearTimeout(this.intervalID), this.currentPacket.length > 0 && this.push(Buffer.from(this.currentPacket)), this.currentPacket = [];
  }
  _flush(t) {
    this.emitPacket(), t();
  }
}
ge.InterByteTimeoutParser = cr;
var ye = {};
Object.defineProperty(ye, "__esModule", { value: !0 });
ye.PacketLengthParser = void 0;
const lr = $;
class fr extends lr.Transform {
  constructor(t = {}) {
    super(t);
    g(this, "buffer");
    g(this, "start");
    g(this, "opts");
    const { delimiter: e = 170, packetOverhead: a = 2, lengthBytes: c = 1, lengthOffset: f = 1, maxLen: h = 255 } = t;
    this.opts = {
      delimiter: e,
      packetOverhead: a,
      lengthBytes: c,
      lengthOffset: f,
      maxLen: h
    }, this.buffer = Buffer.alloc(0), this.start = !1;
  }
  _transform(t, e, a) {
    for (let c = 0; c < t.length; c++) {
      const f = t[c];
      if (f === this.opts.delimiter && (this.start = !0), this.start === !0 && (this.buffer = Buffer.concat([this.buffer, Buffer.from([f])]), this.buffer.length >= this.opts.lengthOffset + this.opts.lengthBytes)) {
        const h = this.buffer.readUIntLE(this.opts.lengthOffset, this.opts.lengthBytes);
        (this.buffer.length == h + this.opts.packetOverhead || h > this.opts.maxLen) && (this.push(this.buffer), this.buffer = Buffer.alloc(0), this.start = !1);
      }
    }
    a();
  }
  _flush(t) {
    this.push(this.buffer), this.buffer = Buffer.alloc(0), t();
  }
}
ye.PacketLengthParser = fr;
var be = {};
Object.defineProperty(be, "__esModule", { value: !0 });
be.ReadlineParser = void 0;
const dr = te;
let hr = class extends dr.DelimiterParser {
  constructor(r) {
    const t = {
      delimiter: Buffer.from(`
`, "utf8"),
      encoding: "utf8",
      ...r
    };
    typeof t.delimiter == "string" && (t.delimiter = Buffer.from(t.delimiter, t.encoding)), super(t);
  }
};
be.ReadlineParser = hr;
var Ce = {};
Object.defineProperty(Ce, "__esModule", { value: !0 });
Ce.ReadyParser = void 0;
const pr = $;
class mr extends pr.Transform {
  constructor({ delimiter: t, ...e }) {
    if (t === void 0)
      throw new TypeError('"delimiter" is not a bufferable object');
    if (t.length === 0)
      throw new TypeError('"delimiter" has a 0 or undefined length');
    super(e);
    g(this, "delimiter");
    g(this, "readOffset");
    g(this, "ready");
    this.delimiter = Buffer.from(t), this.readOffset = 0, this.ready = !1;
  }
  _transform(t, e, a) {
    if (this.ready)
      return this.push(t), a();
    const c = this.delimiter;
    let f = 0;
    for (; this.readOffset < c.length && f < t.length; )
      c[this.readOffset] === t[f] ? this.readOffset++ : this.readOffset = 0, f++;
    if (this.readOffset === c.length) {
      this.ready = !0, this.emit("ready");
      const h = t.slice(f);
      h.length > 0 && this.push(h);
    }
    a();
  }
}
Ce.ReadyParser = mr;
var _e = {};
Object.defineProperty(_e, "__esModule", { value: !0 });
_e.RegexParser = void 0;
const wr = $;
class gr extends wr.Transform {
  constructor({ regex: t, ...e }) {
    const a = {
      encoding: "utf8",
      ...e
    };
    if (t === void 0)
      throw new TypeError('"options.regex" must be a regular expression pattern or object');
    t instanceof RegExp || (t = new RegExp(t.toString()));
    super(a);
    g(this, "regex");
    g(this, "data");
    this.regex = t, this.data = "";
  }
  _transform(t, e, a) {
    const f = (this.data + t).split(this.regex);
    this.data = f.pop() || "", f.forEach((h) => {
      this.push(h);
    }), a();
  }
  _flush(t) {
    this.push(this.data), this.data = "", t();
  }
}
_e.RegexParser = gr;
var jt = {}, ve = {};
Object.defineProperty(ve, "__esModule", { value: !0 });
ve.SlipDecoder = void 0;
const yr = $;
class br extends yr.Transform {
  constructor(t = {}) {
    super(t);
    g(this, "opts");
    g(this, "buffer");
    g(this, "escape");
    g(this, "start");
    const { START: e, ESC: a = 219, END: c = 192, ESC_START: f, ESC_END: h = 220, ESC_ESC: o = 221 } = t;
    this.opts = {
      START: e,
      ESC: a,
      END: c,
      ESC_START: f,
      ESC_END: h,
      ESC_ESC: o
    }, this.buffer = Buffer.alloc(0), this.escape = !1, this.start = !1;
  }
  _transform(t, e, a) {
    for (let c = 0; c < t.length; c++) {
      let f = t[c];
      if (f === this.opts.START) {
        this.start = !0;
        continue;
      } else this.opts.START == null && (this.start = !0);
      if (this.escape)
        f === this.opts.ESC_START && this.opts.START ? f = this.opts.START : f === this.opts.ESC_ESC ? f = this.opts.ESC : f === this.opts.ESC_END ? f = this.opts.END : (this.escape = !1, this.push(this.buffer), this.buffer = Buffer.alloc(0));
      else {
        if (f === this.opts.ESC) {
          this.escape = !0;
          continue;
        }
        if (f === this.opts.END) {
          this.push(this.buffer), this.buffer = Buffer.alloc(0), this.escape = !1, this.start = !1;
          continue;
        }
      }
      this.escape = !1, this.start && (this.buffer = Buffer.concat([this.buffer, Buffer.from([f])]));
    }
    a();
  }
  _flush(t) {
    this.push(this.buffer), this.buffer = Buffer.alloc(0), t();
  }
}
ve.SlipDecoder = br;
var Ee = {};
Object.defineProperty(Ee, "__esModule", { value: !0 });
Ee.SlipEncoder = void 0;
const Cr = $;
class _r extends Cr.Transform {
  constructor(t = {}) {
    super(t);
    g(this, "opts");
    const { START: e, ESC: a = 219, END: c = 192, ESC_START: f, ESC_END: h = 220, ESC_ESC: o = 221, bluetoothQuirk: d = !1 } = t;
    this.opts = {
      START: e,
      ESC: a,
      END: c,
      ESC_START: f,
      ESC_END: h,
      ESC_ESC: o,
      bluetoothQuirk: d
    };
  }
  _transform(t, e, a) {
    const c = t.length;
    if (this.opts.bluetoothQuirk && c === 0)
      return a();
    const f = Buffer.alloc(c * 2 + 2);
    let h = 0;
    this.opts.bluetoothQuirk == !0 && (f[h++] = this.opts.END), this.opts.START !== void 0 && (f[h++] = this.opts.START);
    for (let o = 0; o < c; o++) {
      let d = t[o];
      d === this.opts.START && this.opts.ESC_START ? (f[h++] = this.opts.ESC, d = this.opts.ESC_START) : d === this.opts.END ? (f[h++] = this.opts.ESC, d = this.opts.ESC_END) : d === this.opts.ESC && (f[h++] = this.opts.ESC, d = this.opts.ESC_ESC), f[h++] = d;
    }
    f[h++] = this.opts.END, a(null, f.slice(0, h));
  }
}
Ee.SlipEncoder = _r;
(function(s) {
  var r = v && v.__createBinding || (Object.create ? function(e, a, c, f) {
    f === void 0 && (f = c);
    var h = Object.getOwnPropertyDescriptor(a, c);
    (!h || ("get" in h ? !a.__esModule : h.writable || h.configurable)) && (h = { enumerable: !0, get: function() {
      return a[c];
    } }), Object.defineProperty(e, f, h);
  } : function(e, a, c, f) {
    f === void 0 && (f = c), e[f] = a[c];
  }), t = v && v.__exportStar || function(e, a) {
    for (var c in e) c !== "default" && !Object.prototype.hasOwnProperty.call(a, c) && r(a, e, c);
  };
  Object.defineProperty(s, "__esModule", { value: !0 }), t(ve, s), t(Ee, s);
})(jt);
var Oe = {}, At = {};
(function(s) {
  Object.defineProperty(s, "__esModule", { value: !0 }), s.convertHeaderBufferToObj = s.HEADER_LENGTH = void 0, s.HEADER_LENGTH = 6;
  const r = (e) => {
    let a = Number(e).toString(2);
    for (; a.length < 8; )
      a = `0${a}`;
    return a;
  }, t = (e) => {
    const a = Array.from(e.slice(0, s.HEADER_LENGTH)).reduce((l, p) => `${l}${r(p)}`, ""), f = a.slice(0, 3) === "000" ? 1 : "UNKNOWN_VERSION", h = Number(a[3]), o = Number(a[4]), d = parseInt(a.slice(5, 16), 2), u = parseInt(a.slice(16, 18), 2), i = parseInt(a.slice(18, 32), 2), n = parseInt(a.slice(-16), 2) + 1;
    return {
      versionNumber: f,
      identification: {
        apid: d,
        secondaryHeader: o,
        type: h
      },
      sequenceControl: {
        packetName: i,
        sequenceFlags: u
      },
      dataLength: n
    };
  };
  s.convertHeaderBufferToObj = t;
})(At);
Object.defineProperty(Oe, "__esModule", { value: !0 });
Oe.SpacePacketParser = void 0;
const vr = $, ie = At;
class Er extends vr.Transform {
  /**
   * A Transform stream that accepts a stream of octet data and emits object representations of
   * CCSDS Space Packets once a packet has been completely received.
   * @param {Object} [options] Configuration options for the stream
   * @param {Number} options.timeCodeFieldLength The length of the time code field within the data
   * @param {Number} options.ancillaryDataFieldLength The length of the ancillary data field within the data
   */
  constructor(t = {}) {
    super({ ...t, objectMode: !0 });
    g(this, "timeCodeFieldLength");
    g(this, "ancillaryDataFieldLength");
    g(this, "dataBuffer");
    g(this, "headerBuffer");
    g(this, "dataLength");
    g(this, "expectingHeader");
    g(this, "dataSlice");
    g(this, "header");
    this.timeCodeFieldLength = t.timeCodeFieldLength || 0, this.ancillaryDataFieldLength = t.ancillaryDataFieldLength || 0, this.dataSlice = this.timeCodeFieldLength + this.ancillaryDataFieldLength, this.dataBuffer = Buffer.alloc(0), this.headerBuffer = Buffer.alloc(0), this.dataLength = 0, this.expectingHeader = !0;
  }
  /**
   * Bundle the header, secondary header if present, and the data into a JavaScript object to emit.
   * If more data has been received past the current packet, begin the process of parsing the next
   * packet(s).
   */
  pushCompletedPacket() {
    if (!this.header)
      throw new Error("Missing header");
    const t = Buffer.from(this.dataBuffer.slice(0, this.timeCodeFieldLength)), e = Buffer.from(this.dataBuffer.slice(this.timeCodeFieldLength, this.timeCodeFieldLength + this.ancillaryDataFieldLength)), a = Buffer.from(this.dataBuffer.slice(this.dataSlice, this.dataLength)), c = {
      header: { ...this.header },
      data: a.toString()
    };
    (t.length > 0 || e.length > 0) && (c.secondaryHeader = {}, t.length && (c.secondaryHeader.timeCode = t.toString()), e.length && (c.secondaryHeader.ancillaryData = e.toString())), this.push(c);
    const f = Buffer.from(this.dataBuffer.slice(this.dataLength));
    f.length >= ie.HEADER_LENGTH ? this.extractHeader(f) : (this.headerBuffer = f, this.dataBuffer = Buffer.alloc(0), this.expectingHeader = !0, this.dataLength = 0, this.header = void 0);
  }
  /**
   * Build the Stream's headerBuffer property from the received Buffer chunk; extract data from it
   * if it's complete. If there's more to the chunk than just the header, initiate handling the
   * packet data.
   * @param chunk -  Build the Stream's headerBuffer property from
   */
  extractHeader(t) {
    const e = Buffer.concat([this.headerBuffer, t]), a = e.slice(ie.HEADER_LENGTH);
    e.length >= ie.HEADER_LENGTH ? (this.header = (0, ie.convertHeaderBufferToObj)(e), this.dataLength = this.header.dataLength, this.headerBuffer = Buffer.alloc(0), this.expectingHeader = !1) : this.headerBuffer = e, a.length > 0 && (this.dataBuffer = Buffer.from(a), this.dataBuffer.length >= this.dataLength && this.pushCompletedPacket());
  }
  _transform(t, e, a) {
    this.expectingHeader ? this.extractHeader(t) : (this.dataBuffer = Buffer.concat([this.dataBuffer, t]), this.dataBuffer.length >= this.dataLength && this.pushCompletedPacket()), a();
  }
  _flush(t) {
    const e = Buffer.concat([this.headerBuffer, this.dataBuffer]), a = Array.from(e);
    this.push(a), t();
  }
}
Oe.SpacePacketParser = Er;
var Be = {}, z = {}, Ge = { exports: {} }, se = { exports: {} }, $e, ft;
function Or() {
  if (ft) return $e;
  ft = 1;
  var s = 1e3, r = s * 60, t = r * 60, e = t * 24, a = e * 7, c = e * 365.25;
  $e = function(u, i) {
    i = i || {};
    var n = typeof u;
    if (n === "string" && u.length > 0)
      return f(u);
    if (n === "number" && isFinite(u))
      return i.long ? o(u) : h(u);
    throw new Error(
      "val is not a non-empty string or a valid number. val=" + JSON.stringify(u)
    );
  };
  function f(u) {
    if (u = String(u), !(u.length > 100)) {
      var i = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        u
      );
      if (i) {
        var n = parseFloat(i[1]), l = (i[2] || "ms").toLowerCase();
        switch (l) {
          case "years":
          case "year":
          case "yrs":
          case "yr":
          case "y":
            return n * c;
          case "weeks":
          case "week":
          case "w":
            return n * a;
          case "days":
          case "day":
          case "d":
            return n * e;
          case "hours":
          case "hour":
          case "hrs":
          case "hr":
          case "h":
            return n * t;
          case "minutes":
          case "minute":
          case "mins":
          case "min":
          case "m":
            return n * r;
          case "seconds":
          case "second":
          case "secs":
          case "sec":
          case "s":
            return n * s;
          case "milliseconds":
          case "millisecond":
          case "msecs":
          case "msec":
          case "ms":
            return n;
          default:
            return;
        }
      }
    }
  }
  function h(u) {
    var i = Math.abs(u);
    return i >= e ? Math.round(u / e) + "d" : i >= t ? Math.round(u / t) + "h" : i >= r ? Math.round(u / r) + "m" : i >= s ? Math.round(u / s) + "s" : u + "ms";
  }
  function o(u) {
    var i = Math.abs(u);
    return i >= e ? d(u, i, e, "day") : i >= t ? d(u, i, t, "hour") : i >= r ? d(u, i, r, "minute") : i >= s ? d(u, i, s, "second") : u + " ms";
  }
  function d(u, i, n, l) {
    var p = i >= n * 1.5;
    return Math.round(u / n) + " " + l + (p ? "s" : "");
  }
  return $e;
}
var je, dt;
function Mt() {
  if (dt) return je;
  dt = 1;
  function s(r) {
    e.debug = e, e.default = e, e.coerce = d, e.disable = f, e.enable = c, e.enabled = h, e.humanize = Or(), e.destroy = u, Object.keys(r).forEach((i) => {
      e[i] = r[i];
    }), e.names = [], e.skips = [], e.formatters = {};
    function t(i) {
      let n = 0;
      for (let l = 0; l < i.length; l++)
        n = (n << 5) - n + i.charCodeAt(l), n |= 0;
      return e.colors[Math.abs(n) % e.colors.length];
    }
    e.selectColor = t;
    function e(i) {
      let n, l = null, p, m;
      function y(...w) {
        if (!y.enabled)
          return;
        const E = y, R = Number(/* @__PURE__ */ new Date()), U = R - (n || R);
        E.diff = U, E.prev = n, E.curr = R, n = R, w[0] = e.coerce(w[0]), typeof w[0] != "string" && w.unshift("%O");
        let N = 0;
        w[0] = w[0].replace(/%([a-zA-Z%])/g, (S, V) => {
          if (S === "%%")
            return "%";
          N++;
          const x = e.formatters[V];
          if (typeof x == "function") {
            const G = w[N];
            S = x.call(E, G), w.splice(N, 1), N--;
          }
          return S;
        }), e.formatArgs.call(E, w), (E.log || e.log).apply(E, w);
      }
      return y.namespace = i, y.useColors = e.useColors(), y.color = e.selectColor(i), y.extend = a, y.destroy = e.destroy, Object.defineProperty(y, "enabled", {
        enumerable: !0,
        configurable: !1,
        get: () => l !== null ? l : (p !== e.namespaces && (p = e.namespaces, m = e.enabled(i)), m),
        set: (w) => {
          l = w;
        }
      }), typeof e.init == "function" && e.init(y), y;
    }
    function a(i, n) {
      const l = e(this.namespace + (typeof n > "u" ? ":" : n) + i);
      return l.log = this.log, l;
    }
    function c(i) {
      e.save(i), e.namespaces = i, e.names = [], e.skips = [];
      let n;
      const l = (typeof i == "string" ? i : "").split(/[\s,]+/), p = l.length;
      for (n = 0; n < p; n++)
        l[n] && (i = l[n].replace(/\*/g, ".*?"), i[0] === "-" ? e.skips.push(new RegExp("^" + i.slice(1) + "$")) : e.names.push(new RegExp("^" + i + "$")));
    }
    function f() {
      const i = [
        ...e.names.map(o),
        ...e.skips.map(o).map((n) => "-" + n)
      ].join(",");
      return e.enable(""), i;
    }
    function h(i) {
      if (i[i.length - 1] === "*")
        return !0;
      let n, l;
      for (n = 0, l = e.skips.length; n < l; n++)
        if (e.skips[n].test(i))
          return !1;
      for (n = 0, l = e.names.length; n < l; n++)
        if (e.names[n].test(i))
          return !0;
      return !1;
    }
    function o(i) {
      return i.toString().substring(2, i.toString().length - 2).replace(/\.\*\?$/, "*");
    }
    function d(i) {
      return i instanceof Error ? i.stack || i.message : i;
    }
    function u() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    return e.enable(e.load()), e;
  }
  return je = s, je;
}
var ht;
function Br() {
  return ht || (ht = 1, function(s, r) {
    r.formatArgs = e, r.save = a, r.load = c, r.useColors = t, r.storage = f(), r.destroy = /* @__PURE__ */ (() => {
      let o = !1;
      return () => {
        o || (o = !0, console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."));
      };
    })(), r.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function t() {
      return typeof window < "u" && window.process && (window.process.type === "renderer" || window.process.__nwjs) ? !0 : typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/) ? !1 : typeof document < "u" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window < "u" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function e(o) {
      if (o[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + o[0] + (this.useColors ? "%c " : " ") + "+" + s.exports.humanize(this.diff), !this.useColors)
        return;
      const d = "color: " + this.color;
      o.splice(1, 0, d, "color: inherit");
      let u = 0, i = 0;
      o[0].replace(/%[a-zA-Z%]/g, (n) => {
        n !== "%%" && (u++, n === "%c" && (i = u));
      }), o.splice(i, 0, d);
    }
    r.log = console.debug || console.log || (() => {
    });
    function a(o) {
      try {
        o ? r.storage.setItem("debug", o) : r.storage.removeItem("debug");
      } catch {
      }
    }
    function c() {
      let o;
      try {
        o = r.storage.getItem("debug");
      } catch {
      }
      return !o && typeof process < "u" && "env" in process && (o = process.env.DEBUG), o;
    }
    function f() {
      try {
        return localStorage;
      } catch {
      }
    }
    s.exports = Mt()(r);
    const { formatters: h } = s.exports;
    h.j = function(o) {
      try {
        return JSON.stringify(o);
      } catch (d) {
        return "[UnexpectedJSONParseError]: " + d.message;
      }
    };
  }(se, se.exports)), se.exports;
}
var oe = { exports: {} }, Ae, pt;
function Fr() {
  return pt || (pt = 1, Ae = (s, r) => {
    r = r || process.argv;
    const t = s.startsWith("-") ? "" : s.length === 1 ? "-" : "--", e = r.indexOf(t + s), a = r.indexOf("--");
    return e !== -1 && (a === -1 ? !0 : e < a);
  }), Ae;
}
var Me, mt;
function rt() {
  if (mt) return Me;
  mt = 1;
  const s = $t, r = Fr(), t = process.env;
  let e;
  r("no-color") || r("no-colors") || r("color=false") ? e = !1 : (r("color") || r("colors") || r("color=true") || r("color=always")) && (e = !0), "FORCE_COLOR" in t && (e = t.FORCE_COLOR.length === 0 || parseInt(t.FORCE_COLOR, 10) !== 0);
  function a(h) {
    return h === 0 ? !1 : {
      level: h,
      hasBasic: !0,
      has256: h >= 2,
      has16m: h >= 3
    };
  }
  function c(h) {
    if (e === !1)
      return 0;
    if (r("color=16m") || r("color=full") || r("color=truecolor"))
      return 3;
    if (r("color=256"))
      return 2;
    if (h && !h.isTTY && e !== !0)
      return 0;
    const o = e ? 1 : 0;
    if (process.platform === "win32") {
      const d = s.release().split(".");
      return Number(process.versions.node.split(".")[0]) >= 8 && Number(d[0]) >= 10 && Number(d[2]) >= 10586 ? Number(d[2]) >= 14931 ? 3 : 2 : 1;
    }
    if ("CI" in t)
      return ["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI"].some((d) => d in t) || t.CI_NAME === "codeship" ? 1 : o;
    if ("TEAMCITY_VERSION" in t)
      return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(t.TEAMCITY_VERSION) ? 1 : 0;
    if (t.COLORTERM === "truecolor")
      return 3;
    if ("TERM_PROGRAM" in t) {
      const d = parseInt((t.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
      switch (t.TERM_PROGRAM) {
        case "iTerm.app":
          return d >= 3 ? 3 : 2;
        case "Apple_Terminal":
          return 2;
      }
    }
    return /-256(color)?$/i.test(t.TERM) ? 2 : /^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(t.TERM) || "COLORTERM" in t ? 1 : (t.TERM === "dumb", o);
  }
  function f(h) {
    const o = c(h);
    return a(o);
  }
  return Me = {
    supportsColor: f,
    stdout: f(process.stdout),
    stderr: f(process.stderr)
  }, Me;
}
var wt;
function Pr() {
  return wt || (wt = 1, function(s, r) {
    const t = Xe, e = X;
    r.init = u, r.log = h, r.formatArgs = c, r.save = o, r.load = d, r.useColors = a, r.destroy = e.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    ), r.colors = [6, 2, 3, 4, 5, 1];
    try {
      const n = rt();
      n && (n.stderr || n).level >= 2 && (r.colors = [
        20,
        21,
        26,
        27,
        32,
        33,
        38,
        39,
        40,
        41,
        42,
        43,
        44,
        45,
        56,
        57,
        62,
        63,
        68,
        69,
        74,
        75,
        76,
        77,
        78,
        79,
        80,
        81,
        92,
        93,
        98,
        99,
        112,
        113,
        128,
        129,
        134,
        135,
        148,
        149,
        160,
        161,
        162,
        163,
        164,
        165,
        166,
        167,
        168,
        169,
        170,
        171,
        172,
        173,
        178,
        179,
        184,
        185,
        196,
        197,
        198,
        199,
        200,
        201,
        202,
        203,
        204,
        205,
        206,
        207,
        208,
        209,
        214,
        215,
        220,
        221
      ]);
    } catch {
    }
    r.inspectOpts = Object.keys(process.env).filter((n) => /^debug_/i.test(n)).reduce((n, l) => {
      const p = l.substring(6).toLowerCase().replace(/_([a-z])/g, (y, w) => w.toUpperCase());
      let m = process.env[l];
      return /^(yes|on|true|enabled)$/i.test(m) ? m = !0 : /^(no|off|false|disabled)$/i.test(m) ? m = !1 : m === "null" ? m = null : m = Number(m), n[p] = m, n;
    }, {});
    function a() {
      return "colors" in r.inspectOpts ? !!r.inspectOpts.colors : t.isatty(process.stderr.fd);
    }
    function c(n) {
      const { namespace: l, useColors: p } = this;
      if (p) {
        const m = this.color, y = "\x1B[3" + (m < 8 ? m : "8;5;" + m), w = `  ${y};1m${l} \x1B[0m`;
        n[0] = w + n[0].split(`
`).join(`
` + w), n.push(y + "m+" + s.exports.humanize(this.diff) + "\x1B[0m");
      } else
        n[0] = f() + l + " " + n[0];
    }
    function f() {
      return r.inspectOpts.hideDate ? "" : (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function h(...n) {
      return process.stderr.write(e.format(...n) + `
`);
    }
    function o(n) {
      n ? process.env.DEBUG = n : delete process.env.DEBUG;
    }
    function d() {
      return process.env.DEBUG;
    }
    function u(n) {
      n.inspectOpts = {};
      const l = Object.keys(r.inspectOpts);
      for (let p = 0; p < l.length; p++)
        n.inspectOpts[l[p]] = r.inspectOpts[l[p]];
    }
    s.exports = Mt()(r);
    const { formatters: i } = s.exports;
    i.o = function(n) {
      return this.inspectOpts.colors = this.useColors, e.inspect(n, this.inspectOpts).split(`
`).map((l) => l.trim()).join(" ");
    }, i.O = function(n) {
      return this.inspectOpts.colors = this.useColors, e.inspect(n, this.inspectOpts);
    };
  }(oe, oe.exports)), oe.exports;
}
typeof process > "u" || process.type === "renderer" || process.browser === !0 || process.__nwjs ? Ge.exports = Br() : Ge.exports = Pr();
var Rr = Ge.exports, Nr = v && v.__importDefault || function(s) {
  return s && s.__esModule ? s : { default: s };
};
Object.defineProperty(z, "__esModule", { value: !0 });
z.SerialPortStream = z.DisconnectedError = void 0;
const Tr = $, Dr = Nr(Rr), b = (0, Dr.default)("serialport/stream");
class It extends Error {
  constructor(t) {
    super(t);
    g(this, "disconnected");
    this.disconnected = !0;
  }
}
z.DisconnectedError = It;
const Sr = {
  brk: !1,
  cts: !1,
  dtr: !0,
  rts: !0
};
function gt(s) {
  const r = Buffer.allocUnsafe(s);
  return r.used = 0, r;
}
class $r extends Tr.Duplex {
  /**
   * Create a new serial port object for the `path`. In the case of invalid arguments or invalid options, when constructing a new SerialPort it will throw an error. The port will open automatically by default, which is the equivalent of calling `port.open(openCallback)` in the next tick. You can disable this by setting the option `autoOpen` to `false`.
   * @emits open
   * @emits data
   * @emits close
   * @emits error
   */
  constructor(t, e) {
    const a = {
      autoOpen: !0,
      endOnClose: !1,
      highWaterMark: 65536,
      ...t
    };
    super({
      highWaterMark: a.highWaterMark
    });
    g(this, "port");
    g(this, "_pool");
    g(this, "_kMinPoolSpace");
    g(this, "opening");
    g(this, "closing");
    g(this, "settings");
    if (!a.binding)
      throw new TypeError('"Bindings" is invalid pass it as `options.binding`');
    if (!a.path)
      throw new TypeError(`"path" is not defined: ${a.path}`);
    if (typeof a.baudRate != "number")
      throw new TypeError(`"baudRate" must be a number: ${a.baudRate}`);
    this.settings = a, this.opening = !1, this.closing = !1, this._pool = gt(this.settings.highWaterMark), this._kMinPoolSpace = 128, this.settings.autoOpen && this.open(e);
  }
  get path() {
    return this.settings.path;
  }
  get baudRate() {
    return this.settings.baudRate;
  }
  get isOpen() {
    var t;
    return (((t = this.port) == null ? void 0 : t.isOpen) ?? !1) && !this.closing;
  }
  _error(t, e) {
    e ? e.call(this, t) : this.emit("error", t);
  }
  _asyncError(t, e) {
    process.nextTick(() => this._error(t, e));
  }
  /**
   * Opens a connection to the given serial port.
   * @param {ErrorCallback=} openCallback - Called after a connection is opened. If this is not provided and an error occurs, it will be emitted on the port's `error` event.
   * @emits open
   */
  open(t) {
    if (this.isOpen)
      return this._asyncError(new Error("Port is already open"), t);
    if (this.opening)
      return this._asyncError(new Error("Port is opening"), t);
    const { highWaterMark: e, binding: a, autoOpen: c, endOnClose: f, ...h } = this.settings;
    this.opening = !0, b("opening", `path: ${this.path}`), this.settings.binding.open(h).then((o) => {
      b("opened", `path: ${this.path}`), this.port = o, this.opening = !1, this.emit("open"), t && t.call(this, null);
    }, (o) => {
      this.opening = !1, b("Binding #open had an error", o), this._error(o, t);
    });
  }
  /**
   * Changes the baud rate for an open port. Emits an error or calls the callback if the baud rate isn't supported.
   * @param {object=} options Only supports `baudRate`.
   * @param {number=} [options.baudRate] The baud rate of the port to be opened. This should match one of the commonly available baud rates, such as 110, 300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, or 115200. Custom rates are supported best effort per platform. The device connected to the serial port is not guaranteed to support the requested baud rate, even if the port itself supports that baud rate.
   * @param {ErrorCallback=} [callback] Called once the port's baud rate changes. If `.update` is called without a callback, and there is an error, an error event is emitted.
   * @returns {undefined}
   */
  update(t, e) {
    if (!this.isOpen || !this.port)
      return b("update attempted, but port is not open"), this._asyncError(new Error("Port is not open"), e);
    b("update", `baudRate: ${t.baudRate}`), this.port.update(t).then(() => {
      b("binding.update", "finished"), this.settings.baudRate = t.baudRate, e && e.call(this, null);
    }, (a) => (b("binding.update", "error", a), this._error(a, e)));
  }
  write(t, e, a) {
    return Array.isArray(t) && (t = Buffer.from(t)), typeof e == "function" ? super.write(t, e) : super.write(t, e, a);
  }
  _write(t, e, a) {
    if (!this.isOpen || !this.port) {
      this.once("open", () => {
        this._write(t, e, a);
      });
      return;
    }
    b("_write", `${t.length} bytes of data`), this.port.write(t).then(() => {
      b("binding.write", "write finished"), a(null);
    }, (c) => {
      b("binding.write", "error", c), c.canceled || this._disconnected(c), a(c);
    });
  }
  _writev(t, e) {
    b("_writev", `${t.length} chunks of data`);
    const a = t.map((c) => c.chunk);
    this._write(Buffer.concat(a), void 0, e);
  }
  _read(t) {
    if (!this.isOpen || !this.port) {
      b("_read", "queueing _read for after open"), this.once("open", () => {
        this._read(t);
      });
      return;
    }
    (!this._pool || this._pool.length - this._pool.used < this._kMinPoolSpace) && (b("_read", "discarding the read buffer pool because it is below kMinPoolSpace"), this._pool = gt(this.settings.highWaterMark));
    const e = this._pool, a = Math.min(e.length - e.used, t), c = e.used;
    b("_read", "reading", { start: c, toRead: a }), this.port.read(e, c, a).then(({ bytesRead: f }) => {
      if (b("binding.read", "finished", { bytesRead: f }), f === 0) {
        b("binding.read", "Zero bytes read closing readable stream"), this.push(null);
        return;
      }
      e.used += f, this.push(e.slice(c, c + f));
    }, (f) => {
      b("binding.read", "error", f), f.canceled || this._disconnected(f), this._read(t);
    });
  }
  _disconnected(t) {
    if (!this.isOpen) {
      b("disconnected aborted because already closed", t);
      return;
    }
    b("disconnected", t), this.close(void 0, new It(t.message));
  }
  /**
   * Closes an open connection.
   *
   * If there are in progress writes when the port is closed the writes will error.
   * @param {ErrorCallback} callback Called once a connection is closed.
   * @param {Error} disconnectError used internally to propagate a disconnect error
   */
  close(t, e = null) {
    if (!this.isOpen || !this.port)
      return b("close attempted, but port is not open"), this._asyncError(new Error("Port is not open"), t);
    this.closing = !0, b("#close"), this.port.close().then(() => {
      this.closing = !1, b("binding.close", "finished"), this.emit("close", e), this.settings.endOnClose && this.emit("end"), t && t.call(this, e);
    }, (a) => (this.closing = !1, b("binding.close", "had an error", a), this._error(a, t)));
  }
  /**
   * Set control flags on an open port. Uses [`SetCommMask`](https://msdn.microsoft.com/en-us/library/windows/desktop/aa363257(v=vs.85).aspx) for Windows and [`ioctl`](http://linux.die.net/man/4/tty_ioctl) for OS X and Linux.
   *
   * All options are operating system default when the port is opened. Every flag is set on each call to the provided or default values. If options isn't provided default options is used.
   */
  set(t, e) {
    if (!this.isOpen || !this.port)
      return b("set attempted, but port is not open"), this._asyncError(new Error("Port is not open"), e);
    const a = { ...Sr, ...t };
    b("#set", a), this.port.set(a).then(() => {
      b("binding.set", "finished"), e && e.call(this, null);
    }, (c) => (b("binding.set", "had an error", c), this._error(c, e)));
  }
  /**
   * Returns the control flags (CTS, DSR, DCD) on the open port.
   * Uses [`GetCommModemStatus`](https://msdn.microsoft.com/en-us/library/windows/desktop/aa363258(v=vs.85).aspx) for Windows and [`ioctl`](http://linux.die.net/man/4/tty_ioctl) for mac and linux.
   */
  get(t) {
    if (!this.isOpen || !this.port)
      return b("get attempted, but port is not open"), this._asyncError(new Error("Port is not open"), t);
    b("#get"), this.port.get().then((e) => {
      b("binding.get", "finished"), t.call(this, null, e);
    }, (e) => (b("binding.get", "had an error", e), this._error(e, t)));
  }
  /**
   * Flush discards data received but not read, and written but not transmitted by the operating system. For more technical details, see [`tcflush(fd, TCIOFLUSH)`](http://linux.die.net/man/3/tcflush) for Mac/Linux and [`FlushFileBuffers`](http://msdn.microsoft.com/en-us/library/windows/desktop/aa364439) for Windows.
   */
  flush(t) {
    if (!this.isOpen || !this.port)
      return b("flush attempted, but port is not open"), this._asyncError(new Error("Port is not open"), t);
    b("#flush"), this.port.flush().then(() => {
      b("binding.flush", "finished"), t && t.call(this, null);
    }, (e) => (b("binding.flush", "had an error", e), this._error(e, t)));
  }
  /**
     * Waits until all output data is transmitted to the serial port. After any pending write has completed it calls [`tcdrain()`](http://linux.die.net/man/3/tcdrain) or [FlushFileBuffers()](https://msdn.microsoft.com/en-us/library/windows/desktop/aa364439(v=vs.85).aspx) to ensure it has been written to the device.
    * @example
    Write the `data` and wait until it has finished transmitting to the target serial port before calling the callback. This will queue until the port is open and writes are finished.
  
    ```js
    function writeAndDrain (data, callback) {
      port.write(data);
      port.drain(callback);
    }
    ```
    */
  drain(t) {
    if (b("drain"), !this.isOpen || !this.port) {
      b("drain queuing on port open"), this.once("open", () => {
        this.drain(t);
      });
      return;
    }
    this.port.drain().then(() => {
      b("binding.drain", "finished"), t && t.call(this, null);
    }, (e) => (b("binding.drain", "had an error", e), this._error(e, t)));
  }
}
z.SerialPortStream = $r;
var re = {}, He = { exports: {} }, ae = { exports: {} }, Ie, yt;
function jr() {
  if (yt) return Ie;
  yt = 1;
  var s = 1e3, r = s * 60, t = r * 60, e = t * 24, a = e * 7, c = e * 365.25;
  Ie = function(u, i) {
    i = i || {};
    var n = typeof u;
    if (n === "string" && u.length > 0)
      return f(u);
    if (n === "number" && isFinite(u))
      return i.long ? o(u) : h(u);
    throw new Error(
      "val is not a non-empty string or a valid number. val=" + JSON.stringify(u)
    );
  };
  function f(u) {
    if (u = String(u), !(u.length > 100)) {
      var i = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        u
      );
      if (i) {
        var n = parseFloat(i[1]), l = (i[2] || "ms").toLowerCase();
        switch (l) {
          case "years":
          case "year":
          case "yrs":
          case "yr":
          case "y":
            return n * c;
          case "weeks":
          case "week":
          case "w":
            return n * a;
          case "days":
          case "day":
          case "d":
            return n * e;
          case "hours":
          case "hour":
          case "hrs":
          case "hr":
          case "h":
            return n * t;
          case "minutes":
          case "minute":
          case "mins":
          case "min":
          case "m":
            return n * r;
          case "seconds":
          case "second":
          case "secs":
          case "sec":
          case "s":
            return n * s;
          case "milliseconds":
          case "millisecond":
          case "msecs":
          case "msec":
          case "ms":
            return n;
          default:
            return;
        }
      }
    }
  }
  function h(u) {
    var i = Math.abs(u);
    return i >= e ? Math.round(u / e) + "d" : i >= t ? Math.round(u / t) + "h" : i >= r ? Math.round(u / r) + "m" : i >= s ? Math.round(u / s) + "s" : u + "ms";
  }
  function o(u) {
    var i = Math.abs(u);
    return i >= e ? d(u, i, e, "day") : i >= t ? d(u, i, t, "hour") : i >= r ? d(u, i, r, "minute") : i >= s ? d(u, i, s, "second") : u + " ms";
  }
  function d(u, i, n, l) {
    var p = i >= n * 1.5;
    return Math.round(u / n) + " " + l + (p ? "s" : "");
  }
  return Ie;
}
var xe, bt;
function xt() {
  if (bt) return xe;
  bt = 1;
  function s(r) {
    e.debug = e, e.default = e, e.coerce = d, e.disable = f, e.enable = c, e.enabled = h, e.humanize = jr(), e.destroy = u, Object.keys(r).forEach((i) => {
      e[i] = r[i];
    }), e.names = [], e.skips = [], e.formatters = {};
    function t(i) {
      let n = 0;
      for (let l = 0; l < i.length; l++)
        n = (n << 5) - n + i.charCodeAt(l), n |= 0;
      return e.colors[Math.abs(n) % e.colors.length];
    }
    e.selectColor = t;
    function e(i) {
      let n, l = null, p, m;
      function y(...w) {
        if (!y.enabled)
          return;
        const E = y, R = Number(/* @__PURE__ */ new Date()), U = R - (n || R);
        E.diff = U, E.prev = n, E.curr = R, n = R, w[0] = e.coerce(w[0]), typeof w[0] != "string" && w.unshift("%O");
        let N = 0;
        w[0] = w[0].replace(/%([a-zA-Z%])/g, (S, V) => {
          if (S === "%%")
            return "%";
          N++;
          const x = e.formatters[V];
          if (typeof x == "function") {
            const G = w[N];
            S = x.call(E, G), w.splice(N, 1), N--;
          }
          return S;
        }), e.formatArgs.call(E, w), (E.log || e.log).apply(E, w);
      }
      return y.namespace = i, y.useColors = e.useColors(), y.color = e.selectColor(i), y.extend = a, y.destroy = e.destroy, Object.defineProperty(y, "enabled", {
        enumerable: !0,
        configurable: !1,
        get: () => l !== null ? l : (p !== e.namespaces && (p = e.namespaces, m = e.enabled(i)), m),
        set: (w) => {
          l = w;
        }
      }), typeof e.init == "function" && e.init(y), y;
    }
    function a(i, n) {
      const l = e(this.namespace + (typeof n > "u" ? ":" : n) + i);
      return l.log = this.log, l;
    }
    function c(i) {
      e.save(i), e.namespaces = i, e.names = [], e.skips = [];
      let n;
      const l = (typeof i == "string" ? i : "").split(/[\s,]+/), p = l.length;
      for (n = 0; n < p; n++)
        l[n] && (i = l[n].replace(/\*/g, ".*?"), i[0] === "-" ? e.skips.push(new RegExp("^" + i.slice(1) + "$")) : e.names.push(new RegExp("^" + i + "$")));
    }
    function f() {
      const i = [
        ...e.names.map(o),
        ...e.skips.map(o).map((n) => "-" + n)
      ].join(",");
      return e.enable(""), i;
    }
    function h(i) {
      if (i[i.length - 1] === "*")
        return !0;
      let n, l;
      for (n = 0, l = e.skips.length; n < l; n++)
        if (e.skips[n].test(i))
          return !1;
      for (n = 0, l = e.names.length; n < l; n++)
        if (e.names[n].test(i))
          return !0;
      return !1;
    }
    function o(i) {
      return i.toString().substring(2, i.toString().length - 2).replace(/\.\*\?$/, "*");
    }
    function d(i) {
      return i instanceof Error ? i.stack || i.message : i;
    }
    function u() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    return e.enable(e.load()), e;
  }
  return xe = s, xe;
}
var Ct;
function Ar() {
  return Ct || (Ct = 1, function(s, r) {
    r.formatArgs = e, r.save = a, r.load = c, r.useColors = t, r.storage = f(), r.destroy = /* @__PURE__ */ (() => {
      let o = !1;
      return () => {
        o || (o = !0, console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."));
      };
    })(), r.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function t() {
      if (typeof window < "u" && window.process && (window.process.type === "renderer" || window.process.__nwjs))
        return !0;
      if (typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/))
        return !1;
      let o;
      return typeof document < "u" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window < "u" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator < "u" && navigator.userAgent && (o = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(o[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function e(o) {
      if (o[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + o[0] + (this.useColors ? "%c " : " ") + "+" + s.exports.humanize(this.diff), !this.useColors)
        return;
      const d = "color: " + this.color;
      o.splice(1, 0, d, "color: inherit");
      let u = 0, i = 0;
      o[0].replace(/%[a-zA-Z%]/g, (n) => {
        n !== "%%" && (u++, n === "%c" && (i = u));
      }), o.splice(i, 0, d);
    }
    r.log = console.debug || console.log || (() => {
    });
    function a(o) {
      try {
        o ? r.storage.setItem("debug", o) : r.storage.removeItem("debug");
      } catch {
      }
    }
    function c() {
      let o;
      try {
        o = r.storage.getItem("debug");
      } catch {
      }
      return !o && typeof process < "u" && "env" in process && (o = process.env.DEBUG), o;
    }
    function f() {
      try {
        return localStorage;
      } catch {
      }
    }
    s.exports = xt()(r);
    const { formatters: h } = s.exports;
    h.j = function(o) {
      try {
        return JSON.stringify(o);
      } catch (d) {
        return "[UnexpectedJSONParseError]: " + d.message;
      }
    };
  }(ae, ae.exports)), ae.exports;
}
var ue = { exports: {} }, _t;
function Mr() {
  return _t || (_t = 1, function(s, r) {
    const t = Xe, e = X;
    r.init = u, r.log = h, r.formatArgs = c, r.save = o, r.load = d, r.useColors = a, r.destroy = e.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    ), r.colors = [6, 2, 3, 4, 5, 1];
    try {
      const n = rt();
      n && (n.stderr || n).level >= 2 && (r.colors = [
        20,
        21,
        26,
        27,
        32,
        33,
        38,
        39,
        40,
        41,
        42,
        43,
        44,
        45,
        56,
        57,
        62,
        63,
        68,
        69,
        74,
        75,
        76,
        77,
        78,
        79,
        80,
        81,
        92,
        93,
        98,
        99,
        112,
        113,
        128,
        129,
        134,
        135,
        148,
        149,
        160,
        161,
        162,
        163,
        164,
        165,
        166,
        167,
        168,
        169,
        170,
        171,
        172,
        173,
        178,
        179,
        184,
        185,
        196,
        197,
        198,
        199,
        200,
        201,
        202,
        203,
        204,
        205,
        206,
        207,
        208,
        209,
        214,
        215,
        220,
        221
      ]);
    } catch {
    }
    r.inspectOpts = Object.keys(process.env).filter((n) => /^debug_/i.test(n)).reduce((n, l) => {
      const p = l.substring(6).toLowerCase().replace(/_([a-z])/g, (y, w) => w.toUpperCase());
      let m = process.env[l];
      return /^(yes|on|true|enabled)$/i.test(m) ? m = !0 : /^(no|off|false|disabled)$/i.test(m) ? m = !1 : m === "null" ? m = null : m = Number(m), n[p] = m, n;
    }, {});
    function a() {
      return "colors" in r.inspectOpts ? !!r.inspectOpts.colors : t.isatty(process.stderr.fd);
    }
    function c(n) {
      const { namespace: l, useColors: p } = this;
      if (p) {
        const m = this.color, y = "\x1B[3" + (m < 8 ? m : "8;5;" + m), w = `  ${y};1m${l} \x1B[0m`;
        n[0] = w + n[0].split(`
`).join(`
` + w), n.push(y + "m+" + s.exports.humanize(this.diff) + "\x1B[0m");
      } else
        n[0] = f() + l + " " + n[0];
    }
    function f() {
      return r.inspectOpts.hideDate ? "" : (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function h(...n) {
      return process.stderr.write(e.formatWithOptions(r.inspectOpts, ...n) + `
`);
    }
    function o(n) {
      n ? process.env.DEBUG = n : delete process.env.DEBUG;
    }
    function d() {
      return process.env.DEBUG;
    }
    function u(n) {
      n.inspectOpts = {};
      const l = Object.keys(r.inspectOpts);
      for (let p = 0; p < l.length; p++)
        n.inspectOpts[l[p]] = r.inspectOpts[l[p]];
    }
    s.exports = xt()(r);
    const { formatters: i } = s.exports;
    i.o = function(n) {
      return this.inspectOpts.colors = this.useColors, e.inspect(n, this.inspectOpts).split(`
`).map((l) => l.trim()).join(" ");
    }, i.O = function(n) {
      return this.inspectOpts.colors = this.useColors, e.inspect(n, this.inspectOpts);
    };
  }(ue, ue.exports)), ue.exports;
}
typeof process > "u" || process.type === "renderer" || process.browser === !0 || process.__nwjs ? He.exports = Ar() : He.exports = Mr();
var Ir = He.exports;
Object.defineProperty(re, "__esModule", { value: !0 });
var xr = Ir;
function Lr(s) {
  return s && typeof s == "object" && "default" in s ? s : { default: s };
}
var kr = /* @__PURE__ */ Lr(xr);
const P = kr.default("serialport/binding-mock");
let ce = {}, le = 0;
function k() {
  return new Promise((s) => process.nextTick(() => s()));
}
class ze extends Error {
  constructor(r) {
    super(r), this.canceled = !0;
  }
}
const Ur = {
  reset() {
    ce = {}, le = 0;
  },
  // Create a mock port
  createPort(s, r = {}) {
    le++;
    const t = Object.assign({ echo: !1, record: !1, manufacturer: "The J5 Robotics Company", vendorId: void 0, productId: void 0, maxReadSize: 1024 }, r);
    ce[s] = {
      data: Buffer.alloc(0),
      echo: t.echo,
      record: t.record,
      readyData: t.readyData,
      maxReadSize: t.maxReadSize,
      info: {
        path: s,
        manufacturer: t.manufacturer,
        serialNumber: `${le}`,
        pnpId: void 0,
        locationId: void 0,
        vendorId: t.vendorId,
        productId: t.productId
      }
    }, P(le, "created port", JSON.stringify({ path: s, opt: r }));
  },
  async list() {
    return P(null, "list"), Object.values(ce).map((s) => s.info);
  },
  async open(s) {
    var r;
    if (!s || typeof s != "object" || Array.isArray(s))
      throw new TypeError('"options" is not an object');
    if (!s.path)
      throw new TypeError('"path" is not a valid port');
    if (!s.baudRate)
      throw new TypeError('"baudRate" is not a valid baudRate');
    const t = Object.assign({ dataBits: 8, lock: !0, stopBits: 1, parity: "none", rtscts: !1, xon: !1, xoff: !1, xany: !1, hupcl: !0 }, s), { path: e } = t;
    P(null, `open: opening path ${e}`);
    const a = ce[e];
    if (await k(), !a)
      throw new Error(`Port does not exist - please call MockBinding.createPort('${e}') first`);
    const c = a.info.serialNumber;
    if (!((r = a.openOpt) === null || r === void 0) && r.lock)
      throw P(c, "open: Port is locked cannot open"), new Error("Port is locked cannot open");
    return P(c, `open: opened path ${e}`), a.openOpt = Object.assign({}, t), new Lt(a, t);
  }
};
class Lt {
  constructor(r, t) {
    if (this.port = r, this.openOptions = t, this.pendingRead = null, this.isOpen = !0, this.lastWrite = null, this.recording = Buffer.alloc(0), this.writeOperation = null, this.serialNumber = r.info.serialNumber, r.readyData) {
      const e = r.readyData;
      process.nextTick(() => {
        this.isOpen && (P(this.serialNumber, "emitting ready data"), this.emitData(e));
      });
    }
  }
  // Emit data on a mock port
  emitData(r) {
    if (!this.isOpen || !this.port)
      throw new Error("Port must be open to pretend to receive data");
    const t = Buffer.isBuffer(r) ? r : Buffer.from(r);
    P(this.serialNumber, "emitting data - pending read:", !!this.pendingRead), this.port.data = Buffer.concat([this.port.data, t]), this.pendingRead && (process.nextTick(this.pendingRead), this.pendingRead = null);
  }
  async close() {
    if (P(this.serialNumber, "close"), !this.isOpen)
      throw new Error("Port is not open");
    const r = this.port;
    if (!r)
      throw new Error("already closed");
    r.openOpt = void 0, r.data = Buffer.alloc(0), P(this.serialNumber, "port is closed"), this.serialNumber = void 0, this.isOpen = !1, this.pendingRead && this.pendingRead(new ze("port is closed"));
  }
  async read(r, t, e) {
    if (!Buffer.isBuffer(r))
      throw new TypeError('"buffer" is not a Buffer');
    if (typeof t != "number" || isNaN(t))
      throw new TypeError(`"offset" is not an integer got "${isNaN(t) ? "NaN" : typeof t}"`);
    if (typeof e != "number" || isNaN(e))
      throw new TypeError(`"length" is not an integer got "${isNaN(e) ? "NaN" : typeof e}"`);
    if (r.length < t + e)
      throw new Error("buffer is too small");
    if (!this.isOpen)
      throw new Error("Port is not open");
    if (P(this.serialNumber, "read", e, "bytes"), await k(), !this.isOpen || !this.port)
      throw new ze("Read canceled");
    if (this.port.data.length <= 0)
      return new Promise((h, o) => {
        this.pendingRead = (d) => {
          if (d)
            return o(d);
          this.read(r, t, e).then(h, o);
        };
      });
    const a = this.port.maxReadSize > e ? e : this.port.maxReadSize, f = this.port.data.slice(0, a).copy(r, t);
    return this.port.data = this.port.data.slice(a), P(this.serialNumber, "read", f, "bytes"), { bytesRead: f, buffer: r };
  }
  async write(r) {
    if (!Buffer.isBuffer(r))
      throw new TypeError('"buffer" is not a Buffer');
    if (!this.isOpen || !this.port)
      throw P("write", "error port is not open"), new Error("Port is not open");
    if (P(this.serialNumber, "write", r.length, "bytes"), this.writeOperation)
      throw new Error("Overlapping writes are not supported and should be queued by the serialport object");
    return this.writeOperation = (async () => {
      if (await k(), !this.isOpen || !this.port)
        throw new Error("Write canceled");
      const t = this.lastWrite = Buffer.from(r);
      this.port.record && (this.recording = Buffer.concat([this.recording, t])), this.port.echo && process.nextTick(() => {
        this.isOpen && this.emitData(t);
      }), this.writeOperation = null, P(this.serialNumber, "writing finished");
    })(), this.writeOperation;
  }
  async update(r) {
    if (typeof r != "object")
      throw TypeError('"options" is not an object');
    if (typeof r.baudRate != "number")
      throw new TypeError('"options.baudRate" is not a number');
    if (P(this.serialNumber, "update"), !this.isOpen || !this.port)
      throw new Error("Port is not open");
    await k(), this.port.openOpt && (this.port.openOpt.baudRate = r.baudRate);
  }
  async set(r) {
    if (typeof r != "object")
      throw new TypeError('"options" is not an object');
    if (P(this.serialNumber, "set"), !this.isOpen)
      throw new Error("Port is not open");
    await k();
  }
  async get() {
    if (P(this.serialNumber, "get"), !this.isOpen)
      throw new Error("Port is not open");
    return await k(), {
      cts: !0,
      dsr: !1,
      dcd: !1
    };
  }
  async getBaudRate() {
    var r;
    if (P(this.serialNumber, "getBaudRate"), !this.isOpen || !this.port)
      throw new Error("Port is not open");
    if (await k(), !(!((r = this.port.openOpt) === null || r === void 0) && r.baudRate))
      throw new Error("Internal Error");
    return {
      baudRate: this.port.openOpt.baudRate
    };
  }
  async flush() {
    if (P(this.serialNumber, "flush"), !this.isOpen || !this.port)
      throw new Error("Port is not open");
    await k(), this.port.data = Buffer.alloc(0);
  }
  async drain() {
    if (P(this.serialNumber, "drain"), !this.isOpen)
      throw new Error("Port is not open");
    await this.writeOperation, await k();
  }
}
re.CanceledError = ze;
re.MockBinding = Ur;
re.MockPortBinding = Lt;
Object.defineProperty(Be, "__esModule", { value: !0 });
Be.SerialPortMock = void 0;
const qr = z, Le = re;
class Je extends qr.SerialPortStream {
  constructor(r, t) {
    const e = {
      binding: Le.MockBinding,
      ...r
    };
    super(e, t);
  }
}
g(Je, "list", Le.MockBinding.list), g(Je, "binding", Le.MockBinding);
Be.SerialPortMock = Je;
var Fe = {}, ke = {}, Ze = { exports: {} }, fe = { exports: {} }, Ue, vt;
function Wr() {
  if (vt) return Ue;
  vt = 1;
  var s = 1e3, r = s * 60, t = r * 60, e = t * 24, a = e * 7, c = e * 365.25;
  Ue = function(u, i) {
    i = i || {};
    var n = typeof u;
    if (n === "string" && u.length > 0)
      return f(u);
    if (n === "number" && isFinite(u))
      return i.long ? o(u) : h(u);
    throw new Error(
      "val is not a non-empty string or a valid number. val=" + JSON.stringify(u)
    );
  };
  function f(u) {
    if (u = String(u), !(u.length > 100)) {
      var i = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        u
      );
      if (i) {
        var n = parseFloat(i[1]), l = (i[2] || "ms").toLowerCase();
        switch (l) {
          case "years":
          case "year":
          case "yrs":
          case "yr":
          case "y":
            return n * c;
          case "weeks":
          case "week":
          case "w":
            return n * a;
          case "days":
          case "day":
          case "d":
            return n * e;
          case "hours":
          case "hour":
          case "hrs":
          case "hr":
          case "h":
            return n * t;
          case "minutes":
          case "minute":
          case "mins":
          case "min":
          case "m":
            return n * r;
          case "seconds":
          case "second":
          case "secs":
          case "sec":
          case "s":
            return n * s;
          case "milliseconds":
          case "millisecond":
          case "msecs":
          case "msec":
          case "ms":
            return n;
          default:
            return;
        }
      }
    }
  }
  function h(u) {
    var i = Math.abs(u);
    return i >= e ? Math.round(u / e) + "d" : i >= t ? Math.round(u / t) + "h" : i >= r ? Math.round(u / r) + "m" : i >= s ? Math.round(u / s) + "s" : u + "ms";
  }
  function o(u) {
    var i = Math.abs(u);
    return i >= e ? d(u, i, e, "day") : i >= t ? d(u, i, t, "hour") : i >= r ? d(u, i, r, "minute") : i >= s ? d(u, i, s, "second") : u + " ms";
  }
  function d(u, i, n, l) {
    var p = i >= n * 1.5;
    return Math.round(u / n) + " " + l + (p ? "s" : "");
  }
  return Ue;
}
var qe, Et;
function kt() {
  if (Et) return qe;
  Et = 1;
  function s(r) {
    e.debug = e, e.default = e, e.coerce = d, e.disable = f, e.enable = c, e.enabled = h, e.humanize = Wr(), e.destroy = u, Object.keys(r).forEach((i) => {
      e[i] = r[i];
    }), e.names = [], e.skips = [], e.formatters = {};
    function t(i) {
      let n = 0;
      for (let l = 0; l < i.length; l++)
        n = (n << 5) - n + i.charCodeAt(l), n |= 0;
      return e.colors[Math.abs(n) % e.colors.length];
    }
    e.selectColor = t;
    function e(i) {
      let n, l = null, p, m;
      function y(...w) {
        if (!y.enabled)
          return;
        const E = y, R = Number(/* @__PURE__ */ new Date()), U = R - (n || R);
        E.diff = U, E.prev = n, E.curr = R, n = R, w[0] = e.coerce(w[0]), typeof w[0] != "string" && w.unshift("%O");
        let N = 0;
        w[0] = w[0].replace(/%([a-zA-Z%])/g, (S, V) => {
          if (S === "%%")
            return "%";
          N++;
          const x = e.formatters[V];
          if (typeof x == "function") {
            const G = w[N];
            S = x.call(E, G), w.splice(N, 1), N--;
          }
          return S;
        }), e.formatArgs.call(E, w), (E.log || e.log).apply(E, w);
      }
      return y.namespace = i, y.useColors = e.useColors(), y.color = e.selectColor(i), y.extend = a, y.destroy = e.destroy, Object.defineProperty(y, "enabled", {
        enumerable: !0,
        configurable: !1,
        get: () => l !== null ? l : (p !== e.namespaces && (p = e.namespaces, m = e.enabled(i)), m),
        set: (w) => {
          l = w;
        }
      }), typeof e.init == "function" && e.init(y), y;
    }
    function a(i, n) {
      const l = e(this.namespace + (typeof n > "u" ? ":" : n) + i);
      return l.log = this.log, l;
    }
    function c(i) {
      e.save(i), e.namespaces = i, e.names = [], e.skips = [];
      let n;
      const l = (typeof i == "string" ? i : "").split(/[\s,]+/), p = l.length;
      for (n = 0; n < p; n++)
        l[n] && (i = l[n].replace(/\*/g, ".*?"), i[0] === "-" ? e.skips.push(new RegExp("^" + i.slice(1) + "$")) : e.names.push(new RegExp("^" + i + "$")));
    }
    function f() {
      const i = [
        ...e.names.map(o),
        ...e.skips.map(o).map((n) => "-" + n)
      ].join(",");
      return e.enable(""), i;
    }
    function h(i) {
      if (i[i.length - 1] === "*")
        return !0;
      let n, l;
      for (n = 0, l = e.skips.length; n < l; n++)
        if (e.skips[n].test(i))
          return !1;
      for (n = 0, l = e.names.length; n < l; n++)
        if (e.names[n].test(i))
          return !0;
      return !1;
    }
    function o(i) {
      return i.toString().substring(2, i.toString().length - 2).replace(/\.\*\?$/, "*");
    }
    function d(i) {
      return i instanceof Error ? i.stack || i.message : i;
    }
    function u() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    return e.enable(e.load()), e;
  }
  return qe = s, qe;
}
var Ot;
function Vr() {
  return Ot || (Ot = 1, function(s, r) {
    r.formatArgs = e, r.save = a, r.load = c, r.useColors = t, r.storage = f(), r.destroy = /* @__PURE__ */ (() => {
      let o = !1;
      return () => {
        o || (o = !0, console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."));
      };
    })(), r.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function t() {
      return typeof window < "u" && window.process && (window.process.type === "renderer" || window.process.__nwjs) ? !0 : typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/) ? !1 : typeof document < "u" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window < "u" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function e(o) {
      if (o[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + o[0] + (this.useColors ? "%c " : " ") + "+" + s.exports.humanize(this.diff), !this.useColors)
        return;
      const d = "color: " + this.color;
      o.splice(1, 0, d, "color: inherit");
      let u = 0, i = 0;
      o[0].replace(/%[a-zA-Z%]/g, (n) => {
        n !== "%%" && (u++, n === "%c" && (i = u));
      }), o.splice(i, 0, d);
    }
    r.log = console.debug || console.log || (() => {
    });
    function a(o) {
      try {
        o ? r.storage.setItem("debug", o) : r.storage.removeItem("debug");
      } catch {
      }
    }
    function c() {
      let o;
      try {
        o = r.storage.getItem("debug");
      } catch {
      }
      return !o && typeof process < "u" && "env" in process && (o = process.env.DEBUG), o;
    }
    function f() {
      try {
        return localStorage;
      } catch {
      }
    }
    s.exports = kt()(r);
    const { formatters: h } = s.exports;
    h.j = function(o) {
      try {
        return JSON.stringify(o);
      } catch (d) {
        return "[UnexpectedJSONParseError]: " + d.message;
      }
    };
  }(fe, fe.exports)), fe.exports;
}
var de = { exports: {} }, Bt;
function Gr() {
  return Bt || (Bt = 1, function(s, r) {
    const t = Xe, e = X;
    r.init = u, r.log = h, r.formatArgs = c, r.save = o, r.load = d, r.useColors = a, r.destroy = e.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    ), r.colors = [6, 2, 3, 4, 5, 1];
    try {
      const n = rt();
      n && (n.stderr || n).level >= 2 && (r.colors = [
        20,
        21,
        26,
        27,
        32,
        33,
        38,
        39,
        40,
        41,
        42,
        43,
        44,
        45,
        56,
        57,
        62,
        63,
        68,
        69,
        74,
        75,
        76,
        77,
        78,
        79,
        80,
        81,
        92,
        93,
        98,
        99,
        112,
        113,
        128,
        129,
        134,
        135,
        148,
        149,
        160,
        161,
        162,
        163,
        164,
        165,
        166,
        167,
        168,
        169,
        170,
        171,
        172,
        173,
        178,
        179,
        184,
        185,
        196,
        197,
        198,
        199,
        200,
        201,
        202,
        203,
        204,
        205,
        206,
        207,
        208,
        209,
        214,
        215,
        220,
        221
      ]);
    } catch {
    }
    r.inspectOpts = Object.keys(process.env).filter((n) => /^debug_/i.test(n)).reduce((n, l) => {
      const p = l.substring(6).toLowerCase().replace(/_([a-z])/g, (y, w) => w.toUpperCase());
      let m = process.env[l];
      return /^(yes|on|true|enabled)$/i.test(m) ? m = !0 : /^(no|off|false|disabled)$/i.test(m) ? m = !1 : m === "null" ? m = null : m = Number(m), n[p] = m, n;
    }, {});
    function a() {
      return "colors" in r.inspectOpts ? !!r.inspectOpts.colors : t.isatty(process.stderr.fd);
    }
    function c(n) {
      const { namespace: l, useColors: p } = this;
      if (p) {
        const m = this.color, y = "\x1B[3" + (m < 8 ? m : "8;5;" + m), w = `  ${y};1m${l} \x1B[0m`;
        n[0] = w + n[0].split(`
`).join(`
` + w), n.push(y + "m+" + s.exports.humanize(this.diff) + "\x1B[0m");
      } else
        n[0] = f() + l + " " + n[0];
    }
    function f() {
      return r.inspectOpts.hideDate ? "" : (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function h(...n) {
      return process.stderr.write(e.format(...n) + `
`);
    }
    function o(n) {
      n ? process.env.DEBUG = n : delete process.env.DEBUG;
    }
    function d() {
      return process.env.DEBUG;
    }
    function u(n) {
      n.inspectOpts = {};
      const l = Object.keys(r.inspectOpts);
      for (let p = 0; p < l.length; p++)
        n.inspectOpts[l[p]] = r.inspectOpts[l[p]];
    }
    s.exports = kt()(r);
    const { formatters: i } = s.exports;
    i.o = function(n) {
      return this.inspectOpts.colors = this.useColors, e.inspect(n, this.inspectOpts).split(`
`).map((l) => l.trim()).join(" ");
    }, i.O = function(n) {
      return this.inspectOpts.colors = this.useColors, e.inspect(n, this.inspectOpts);
    };
  }(de, de.exports)), de.exports;
}
typeof process > "u" || process.type === "renderer" || process.browser === !0 || process.__nwjs ? Ze.exports = Vr() : Ze.exports = Gr();
var K = Ze.exports, J = {}, B = {}, Ke = { exports: {} };
function Hr(s) {
  throw new Error('Could not dynamically require "' + s + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}
var We, Ft;
function zr() {
  if (Ft) return We;
  Ft = 1;
  var s = et, r = Q, t = $t, e = typeof __webpack_require__ == "function" ? __non_webpack_require__ : Hr, a = process.config && process.config.variables || {}, c = !!process.env.PREBUILDS_ONLY, f = process.versions.modules, h = x() ? "electron" : V() ? "node-webkit" : "node", o = process.env.npm_config_arch || t.arch(), d = process.env.npm_config_platform || t.platform(), u = process.env.LIBC || (G(d) ? "musl" : "glibc"), i = process.env.ARM_VERSION || (o === "arm64" ? "8" : a.arm_version) || "", n = (process.versions.uv || "").split(".")[0];
  We = l;
  function l(C) {
    return e(l.resolve(C));
  }
  l.resolve = l.path = function(C) {
    C = r.resolve(C || ".");
    try {
      var O = e(r.join(C, "package.json")).name.toUpperCase().replace(/-/g, "_");
      process.env[O + "_PREBUILD"] && (C = process.env[O + "_PREBUILD"]);
    } catch {
    }
    if (!c) {
      var _ = m(r.join(C, "build/Release"), y);
      if (_) return _;
      var D = m(r.join(C, "build/Debug"), y);
      if (D) return D;
    }
    var Y = at(C);
    if (Y) return Y;
    var T = at(r.dirname(process.execPath));
    if (T) return T;
    var zt = [
      "platform=" + d,
      "arch=" + o,
      "runtime=" + h,
      "abi=" + f,
      "uv=" + n,
      i ? "armv=" + i : "",
      "libc=" + u,
      "node=" + process.versions.node,
      process.versions.electron ? "electron=" + process.versions.electron : "",
      typeof __webpack_require__ == "function" ? "webpack=true" : ""
      // eslint-disable-line
    ].filter(Boolean).join(" ");
    throw new Error("No native build was found for " + zt + `
    loaded from: ` + C + `
`);
    function at(Se) {
      var Jt = p(r.join(Se, "prebuilds")).map(w), ut = Jt.filter(E(d, o)).sort(R)[0];
      if (ut) {
        var ct = r.join(Se, "prebuilds", ut.name), Zt = p(ct).map(U), Kt = Zt.filter(N(h, f)), lt = Kt.sort(S(h))[0];
        if (lt) return r.join(ct, lt.file);
      }
    }
  };
  function p(C) {
    try {
      return s.readdirSync(C);
    } catch {
      return [];
    }
  }
  function m(C, O) {
    var _ = p(C).filter(O);
    return _[0] && r.join(C, _[0]);
  }
  function y(C) {
    return /\.node$/.test(C);
  }
  function w(C) {
    var O = C.split("-");
    if (O.length === 2) {
      var _ = O[0], D = O[1].split("+");
      if (_ && D.length && D.every(Boolean))
        return { name: C, platform: _, architectures: D };
    }
  }
  function E(C, O) {
    return function(_) {
      return _ == null || _.platform !== C ? !1 : _.architectures.includes(O);
    };
  }
  function R(C, O) {
    return C.architectures.length - O.architectures.length;
  }
  function U(C) {
    var O = C.split("."), _ = O.pop(), D = { file: C, specificity: 0 };
    if (_ === "node") {
      for (var Y = 0; Y < O.length; Y++) {
        var T = O[Y];
        if (T === "node" || T === "electron" || T === "node-webkit")
          D.runtime = T;
        else if (T === "napi")
          D.napi = !0;
        else if (T.slice(0, 3) === "abi")
          D.abi = T.slice(3);
        else if (T.slice(0, 2) === "uv")
          D.uv = T.slice(2);
        else if (T.slice(0, 4) === "armv")
          D.armv = T.slice(4);
        else if (T === "glibc" || T === "musl")
          D.libc = T;
        else
          continue;
        D.specificity++;
      }
      return D;
    }
  }
  function N(C, O) {
    return function(_) {
      return !(_ == null || _.runtime !== C && !ne(_) || _.abi !== O && !_.napi || _.uv && _.uv !== n || _.armv && _.armv !== i || _.libc && _.libc !== u);
    };
  }
  function ne(C) {
    return C.runtime === "node" && C.napi;
  }
  function S(C) {
    return function(O, _) {
      return O.runtime !== _.runtime ? O.runtime === C ? -1 : 1 : O.abi !== _.abi ? O.abi ? -1 : 1 : O.specificity !== _.specificity ? O.specificity > _.specificity ? -1 : 1 : 0;
    };
  }
  function V() {
    return !!(process.versions && process.versions.nw);
  }
  function x() {
    return process.versions && process.versions.electron || process.env.ELECTRON_RUN_AS_NODE ? !0 : typeof window < "u" && window.process && window.process.type === "renderer";
  }
  function G(C) {
    return C === "linux" && s.existsSync("/etc/alpine-release");
  }
  return l.parseTags = U, l.matchTags = N, l.compareTags = S, l.parseTuple = w, l.matchTuple = E, l.compareTuples = R, We;
}
typeof process.addon == "function" ? Ke.exports = process.addon.bind(process) : Ke.exports = zr();
var Ut = Ke.exports, Jr = v && v.__importDefault || function(s) {
  return s && s.__esModule ? s : { default: s };
};
Object.defineProperty(B, "__esModule", { value: !0 });
B.asyncWrite = B.asyncRead = B.asyncUpdate = B.asyncSet = B.asyncOpen = B.asyncList = B.asyncGetBaudRate = B.asyncGet = B.asyncFlush = B.asyncDrain = B.asyncClose = void 0;
const Zr = Jr(Ut), I = X, Kr = Q, F = (0, Zr.default)((0, Kr.join)(__dirname, "../"));
B.asyncClose = F.close ? (0, I.promisify)(F.close) : async () => {
  throw new Error('"binding.close" Method not implemented');
};
B.asyncDrain = F.drain ? (0, I.promisify)(F.drain) : async () => {
  throw new Error('"binding.drain" Method not implemented');
};
B.asyncFlush = F.flush ? (0, I.promisify)(F.flush) : async () => {
  throw new Error('"binding.flush" Method not implemented');
};
B.asyncGet = F.get ? (0, I.promisify)(F.get) : async () => {
  throw new Error('"binding.get" Method not implemented');
};
B.asyncGetBaudRate = F.getBaudRate ? (0, I.promisify)(F.getBaudRate) : async () => {
  throw new Error('"binding.getBaudRate" Method not implemented');
};
B.asyncList = F.list ? (0, I.promisify)(F.list) : async () => {
  throw new Error('"binding.list" Method not implemented');
};
B.asyncOpen = F.open ? (0, I.promisify)(F.open) : async () => {
  throw new Error('"binding.open" Method not implemented');
};
B.asyncSet = F.set ? (0, I.promisify)(F.set) : async () => {
  throw new Error('"binding.set" Method not implemented');
};
B.asyncUpdate = F.update ? (0, I.promisify)(F.update) : async () => {
  throw new Error('"binding.update" Method not implemented');
};
B.asyncRead = F.read ? (0, I.promisify)(F.read) : async () => {
  throw new Error('"binding.read" Method not implemented');
};
B.asyncWrite = F.write ? (0, I.promisify)(F.write) : async () => {
  throw new Error('"binding.write" Method not implemented');
};
var nt = {}, ee = {};
Object.defineProperty(ee, "__esModule", { value: !0 });
ee.BindingsError = void 0;
class Yr extends Error {
  constructor(r, { canceled: t = !1 } = {}) {
    super(r), this.canceled = t;
  }
}
ee.BindingsError = Yr;
(function(s) {
  var r = v && v.__importDefault || function(i) {
    return i && i.__esModule ? i : { default: i };
  };
  Object.defineProperty(s, "__esModule", { value: !0 }), s.Poller = s.EVENTS = void 0;
  const t = r(K), e = Xt, a = Q, c = r(Ut), f = ee, { Poller: h } = (0, c.default)((0, a.join)(__dirname, "../")), o = (0, t.default)("serialport/bindings-cpp/poller");
  s.EVENTS = {
    UV_READABLE: 1,
    UV_WRITABLE: 2,
    UV_DISCONNECT: 4
  };
  function d(i, n) {
    if (i) {
      o("error", i), this.emit("readable", i), this.emit("writable", i), this.emit("disconnect", i);
      return;
    }
    n & s.EVENTS.UV_READABLE && (o('received "readable"'), this.emit("readable", null)), n & s.EVENTS.UV_WRITABLE && (o('received "writable"'), this.emit("writable", null)), n & s.EVENTS.UV_DISCONNECT && (o('received "disconnect"'), this.emit("disconnect", null));
  }
  class u extends e.EventEmitter {
    constructor(n, l = h) {
      o("Creating poller"), super(), this.poller = new l(n, d.bind(this));
    }
    /**
     * Wait for the next event to occur
     * @param {string} event ('readable'|'writable'|'disconnect')
     * @returns {Poller} returns itself
     */
    once(n, l) {
      switch (n) {
        case "readable":
          this.poll(s.EVENTS.UV_READABLE);
          break;
        case "writable":
          this.poll(s.EVENTS.UV_WRITABLE);
          break;
        case "disconnect":
          this.poll(s.EVENTS.UV_DISCONNECT);
          break;
      }
      return super.once(n, l);
    }
    /**
     * Ask the bindings to listen for an event, it is recommend to use `.once()` for easy use
     * @param {EVENTS} eventFlag polls for an event or group of events based upon a flag.
     */
    poll(n = 0) {
      n & s.EVENTS.UV_READABLE && o('Polling for "readable"'), n & s.EVENTS.UV_WRITABLE && o('Polling for "writable"'), n & s.EVENTS.UV_DISCONNECT && o('Polling for "disconnect"'), this.poller.poll(n);
    }
    /**
     * Stop listening for events and cancel all outstanding listening with an error
     */
    stop() {
      o("Stopping poller"), this.poller.stop(), this.emitCanceled();
    }
    destroy() {
      o("Destroying poller"), this.poller.destroy(), this.emitCanceled();
    }
    emitCanceled() {
      const n = new f.BindingsError("Canceled", { canceled: !0 });
      this.emit("readable", n), this.emit("writable", n), this.emit("disconnect", n);
    }
  }
  s.Poller = u;
})(nt);
var it = {};
(function(s) {
  var r = v && v.__importDefault || function(u) {
    return u && u.__esModule ? u : { default: u };
  };
  Object.defineProperty(s, "__esModule", { value: !0 }), s.unixRead = void 0;
  const t = X, e = et, a = ee, f = (0, r(K).default)("serialport/bindings-cpp/unixRead"), h = (0, t.promisify)(e.read), o = (u) => new Promise((i, n) => {
    if (!u.poller)
      throw new Error("No poller on bindings");
    u.poller.once("readable", (l) => l ? n(l) : i());
  }), d = async ({ binding: u, buffer: i, offset: n, length: l, fsReadAsync: p = h }) => {
    if (f("Starting read"), !u.isOpen || !u.fd)
      throw new a.BindingsError("Port is not open", { canceled: !0 });
    try {
      const { bytesRead: m } = await p(u.fd, i, n, l, null);
      return m === 0 ? (0, s.unixRead)({ binding: u, buffer: i, offset: n, length: l, fsReadAsync: p }) : (f("Finished read", m, "bytes"), { bytesRead: m, buffer: i });
    } catch (m) {
      if (f("read error", m), m.code === "EAGAIN" || m.code === "EWOULDBLOCK" || m.code === "EINTR") {
        if (!u.isOpen)
          throw new a.BindingsError("Port is not open", { canceled: !0 });
        return f("waiting for readable because of code:", m.code), await o(u), (0, s.unixRead)({ binding: u, buffer: i, offset: n, length: l, fsReadAsync: p });
      }
      throw (m.code === "EBADF" || // Bad file number means we got closed
      m.code === "ENXIO" || // No such device or address probably usb disconnect
      m.code === "UNKNOWN" || m.errno === -1) && (m.disconnect = !0, f("disconnecting", m)), m;
    }
  };
  s.unixRead = d;
})(it);
var st = {};
(function(s) {
  var r = v && v.__importDefault || function(d) {
    return d && d.__esModule ? d : { default: d };
  };
  Object.defineProperty(s, "__esModule", { value: !0 }), s.unixWrite = void 0;
  const t = et, e = r(K), a = X, c = (0, e.default)("serialport/bindings-cpp/unixWrite"), f = (0, a.promisify)(t.write), h = (d) => new Promise((u, i) => {
    d.poller.once("writable", (n) => n ? i(n) : u());
  }), o = async ({ binding: d, buffer: u, offset: i = 0, fsWriteAsync: n = f }) => {
    const l = u.length - i;
    if (c("Starting write", u.length, "bytes offset", i, "bytesToWrite", l), !d.isOpen || !d.fd)
      throw new Error("Port is not open");
    try {
      const { bytesWritten: p } = await n(d.fd, u, i, l);
      if (c("write returned: wrote", p, "bytes"), p + i < u.length) {
        if (!d.isOpen)
          throw new Error("Port is not open");
        return (0, s.unixWrite)({ binding: d, buffer: u, offset: p + i, fsWriteAsync: n });
      }
      c("Finished writing", p + i, "bytes");
    } catch (p) {
      if (c("write errored", p), p.code === "EAGAIN" || p.code === "EWOULDBLOCK" || p.code === "EINTR") {
        if (!d.isOpen)
          throw new Error("Port is not open");
        return c("waiting for writable because of code:", p.code), await h(d), (0, s.unixWrite)({ binding: d, buffer: u, offset: i, fsWriteAsync: n });
      }
      throw (p.code === "EBADF" || // Bad file number means we got closed
      p.code === "ENXIO" || // No such device or address probably usb disconnect
      p.code === "UNKNOWN" || p.errno === -1) && (p.disconnect = !0, c("disconnecting", p)), c("error", p), p;
    }
  };
  s.unixWrite = o;
})(st);
var Qr = v && v.__importDefault || function(s) {
  return s && s.__esModule ? s : { default: s };
};
Object.defineProperty(J, "__esModule", { value: !0 });
J.DarwinPortBinding = J.DarwinBinding = void 0;
const Xr = Qr(K), W = B, en = nt, tn = it, rn = st, j = (0, Xr.default)("serialport/bindings-cpp");
J.DarwinBinding = {
  list() {
    return j("list"), (0, W.asyncList)();
  },
  async open(s) {
    if (!s || typeof s != "object" || Array.isArray(s))
      throw new TypeError('"options" is not an object');
    if (!s.path)
      throw new TypeError('"path" is not a valid port');
    if (!s.baudRate)
      throw new TypeError('"baudRate" is not a valid baudRate');
    j("open");
    const r = Object.assign({ vmin: 1, vtime: 0, dataBits: 8, lock: !0, stopBits: 1, parity: "none", rtscts: !1, xon: !1, xoff: !1, xany: !1, hupcl: !0 }, s), t = await (0, W.asyncOpen)(r.path, r);
    return new qt(t, r);
  }
};
class qt {
  constructor(r, t) {
    this.fd = r, this.openOptions = t, this.poller = new en.Poller(r), this.writeOperation = null;
  }
  get isOpen() {
    return this.fd !== null;
  }
  async close() {
    if (j("close"), !this.isOpen)
      throw new Error("Port is not open");
    const r = this.fd;
    this.poller.stop(), this.poller.destroy(), this.fd = null, await (0, W.asyncClose)(r);
  }
  async read(r, t, e) {
    if (!Buffer.isBuffer(r))
      throw new TypeError('"buffer" is not a Buffer');
    if (typeof t != "number" || isNaN(t))
      throw new TypeError(`"offset" is not an integer got "${isNaN(t) ? "NaN" : typeof t}"`);
    if (typeof e != "number" || isNaN(e))
      throw new TypeError(`"length" is not an integer got "${isNaN(e) ? "NaN" : typeof e}"`);
    if (j("read"), r.length < t + e)
      throw new Error("buffer is too small");
    if (!this.isOpen)
      throw new Error("Port is not open");
    return (0, tn.unixRead)({ binding: this, buffer: r, offset: t, length: e });
  }
  async write(r) {
    if (!Buffer.isBuffer(r))
      throw new TypeError('"buffer" is not a Buffer');
    if (j("write", r.length, "bytes"), !this.isOpen)
      throw j("write", "error port is not open"), new Error("Port is not open");
    return this.writeOperation = (async () => {
      r.length !== 0 && (await (0, rn.unixWrite)({ binding: this, buffer: r }), this.writeOperation = null);
    })(), this.writeOperation;
  }
  async update(r) {
    if (!r || typeof r != "object" || Array.isArray(r))
      throw TypeError('"options" is not an object');
    if (typeof r.baudRate != "number")
      throw new TypeError('"options.baudRate" is not a number');
    if (j("update"), !this.isOpen)
      throw new Error("Port is not open");
    await (0, W.asyncUpdate)(this.fd, r);
  }
  async set(r) {
    if (!r || typeof r != "object" || Array.isArray(r))
      throw new TypeError('"options" is not an object');
    if (j("set", r), !this.isOpen)
      throw new Error("Port is not open");
    await (0, W.asyncSet)(this.fd, r);
  }
  async get() {
    if (j("get"), !this.isOpen)
      throw new Error("Port is not open");
    return (0, W.asyncGet)(this.fd);
  }
  async getBaudRate() {
    throw j("getBaudRate"), this.isOpen ? new Error("getBaudRate is not implemented on darwin") : new Error("Port is not open");
  }
  async flush() {
    if (j("flush"), !this.isOpen)
      throw new Error("Port is not open");
    await (0, W.asyncFlush)(this.fd);
  }
  async drain() {
    if (j("drain"), !this.isOpen)
      throw new Error("Port is not open");
    await this.writeOperation, await (0, W.asyncDrain)(this.fd);
  }
}
J.DarwinPortBinding = qt;
var Z = {}, Pe = {}, Re = {}, Ne = {};
Object.defineProperty(Ne, "__esModule", { value: !0 });
Ne.DelimiterParser = void 0;
const nn = $;
let sn = class extends nn.Transform {
  constructor({ delimiter: r, includeDelimiter: t = !1, ...e }) {
    if (super(e), r === void 0)
      throw new TypeError('"delimiter" is not a bufferable object');
    if (r.length === 0)
      throw new TypeError('"delimiter" has a 0 or undefined length');
    this.includeDelimiter = t, this.delimiter = Buffer.from(r), this.buffer = Buffer.alloc(0);
  }
  _transform(r, t, e) {
    let a = Buffer.concat([this.buffer, r]), c;
    for (; (c = a.indexOf(this.delimiter)) !== -1; )
      this.push(a.slice(0, c + (this.includeDelimiter ? this.delimiter.length : 0))), a = a.slice(c + this.delimiter.length);
    this.buffer = a, e();
  }
  _flush(r) {
    this.push(this.buffer), this.buffer = Buffer.alloc(0), r();
  }
};
Ne.DelimiterParser = sn;
Object.defineProperty(Re, "__esModule", { value: !0 });
Re.ReadlineParser = void 0;
const on = Ne;
let an = class extends on.DelimiterParser {
  constructor(r) {
    const t = {
      delimiter: Buffer.from(`
`, "utf8"),
      encoding: "utf8",
      ...r
    };
    typeof t.delimiter == "string" && (t.delimiter = Buffer.from(t.delimiter, t.encoding)), super(t);
  }
};
Re.ReadlineParser = an;
Object.defineProperty(Pe, "__esModule", { value: !0 });
Pe.linuxList = void 0;
const un = er, cn = Re;
function ln(s) {
  return /(tty(S|WCH|ACM|USB|AMA|MFD|O|XRUSB)|rfcomm)/.test(s) && s;
}
function fn(s) {
  return {
    DEVNAME: "path",
    ID_VENDOR_ENC: "manufacturer",
    ID_SERIAL_SHORT: "serialNumber",
    ID_VENDOR_ID: "vendorId",
    ID_MODEL_ID: "productId",
    DEVLINKS: "pnpId",
    /**
    * Workaround for systemd defect
    * see https://github.com/serialport/bindings-cpp/issues/115
    */
    ID_USB_VENDOR_ENC: "manufacturer",
    ID_USB_SERIAL_SHORT: "serialNumber",
    ID_USB_VENDOR_ID: "vendorId",
    ID_USB_MODEL_ID: "productId"
    // End of workaround
  }[s.toUpperCase()];
}
function dn(s) {
  return s.replace(/\\x([a-fA-F0-9]{2})/g, (r, t) => String.fromCharCode(parseInt(t, 16)));
}
function hn(s, r) {
  if (s === "pnpId") {
    const t = r.match(/\/by-id\/([^\s]+)/);
    return (t == null ? void 0 : t[1]) || void 0;
  }
  return s === "manufacturer" ? dn(r) : /^0x/.test(r) ? r.substr(2) : r;
}
function pn(s = un.spawn) {
  const r = [], t = s("udevadm", ["info", "-e"]), e = t.stdout.pipe(new cn.ReadlineParser());
  let a = !1, c = {
    path: "",
    manufacturer: void 0,
    serialNumber: void 0,
    pnpId: void 0,
    locationId: void 0,
    vendorId: void 0,
    productId: void 0
  };
  return e.on("data", (f) => {
    const h = f.slice(0, 1), o = f.slice(3);
    if (h === "P") {
      c = {
        path: "",
        manufacturer: void 0,
        serialNumber: void 0,
        pnpId: void 0,
        locationId: void 0,
        vendorId: void 0,
        productId: void 0
      }, a = !1;
      return;
    }
    if (!a) {
      if (h === "N") {
        ln(o) ? r.push(c) : a = !0;
        return;
      }
      if (h === "E") {
        const d = o.match(/^(.+)=(.*)/);
        if (!d)
          return;
        const u = fn(d[1]);
        if (!u)
          return;
        c[u] = hn(u, d[2]);
      }
    }
  }), new Promise((f, h) => {
    t.on("close", (o) => {
      o && h(new Error(`Error listing ports udevadm exited with error code: ${o}`));
    }), t.on("error", h), e.on("error", h), e.on("finish", () => f(r));
  });
}
Pe.linuxList = pn;
var mn = v && v.__importDefault || function(s) {
  return s && s.__esModule ? s : { default: s };
};
Object.defineProperty(Z, "__esModule", { value: !0 });
Z.LinuxPortBinding = Z.LinuxBinding = void 0;
const wn = mn(K), gn = Pe, yn = nt, bn = it, Cn = st, q = B, A = (0, wn.default)("serialport/bindings-cpp");
Z.LinuxBinding = {
  list() {
    return A("list"), (0, gn.linuxList)();
  },
  async open(s) {
    if (!s || typeof s != "object" || Array.isArray(s))
      throw new TypeError('"options" is not an object');
    if (!s.path)
      throw new TypeError('"path" is not a valid port');
    if (!s.baudRate)
      throw new TypeError('"baudRate" is not a valid baudRate');
    A("open");
    const r = Object.assign({ vmin: 1, vtime: 0, dataBits: 8, lock: !0, stopBits: 1, parity: "none", rtscts: !1, xon: !1, xoff: !1, xany: !1, hupcl: !0 }, s), t = await (0, q.asyncOpen)(r.path, r);
    return this.fd = t, new Wt(t, r);
  }
};
class Wt {
  constructor(r, t) {
    this.fd = r, this.openOptions = t, this.poller = new yn.Poller(r), this.writeOperation = null;
  }
  get isOpen() {
    return this.fd !== null;
  }
  async close() {
    if (A("close"), !this.isOpen)
      throw new Error("Port is not open");
    const r = this.fd;
    this.poller.stop(), this.poller.destroy(), this.fd = null, await (0, q.asyncClose)(r);
  }
  async read(r, t, e) {
    if (!Buffer.isBuffer(r))
      throw new TypeError('"buffer" is not a Buffer');
    if (typeof t != "number" || isNaN(t))
      throw new TypeError(`"offset" is not an integer got "${isNaN(t) ? "NaN" : typeof t}"`);
    if (typeof e != "number" || isNaN(e))
      throw new TypeError(`"length" is not an integer got "${isNaN(e) ? "NaN" : typeof e}"`);
    if (A("read"), r.length < t + e)
      throw new Error("buffer is too small");
    if (!this.isOpen)
      throw new Error("Port is not open");
    return (0, bn.unixRead)({ binding: this, buffer: r, offset: t, length: e });
  }
  async write(r) {
    if (!Buffer.isBuffer(r))
      throw new TypeError('"buffer" is not a Buffer');
    if (A("write", r.length, "bytes"), !this.isOpen)
      throw A("write", "error port is not open"), new Error("Port is not open");
    return this.writeOperation = (async () => {
      r.length !== 0 && (await (0, Cn.unixWrite)({ binding: this, buffer: r }), this.writeOperation = null);
    })(), this.writeOperation;
  }
  async update(r) {
    if (!r || typeof r != "object" || Array.isArray(r))
      throw TypeError('"options" is not an object');
    if (typeof r.baudRate != "number")
      throw new TypeError('"options.baudRate" is not a number');
    if (A("update"), !this.isOpen)
      throw new Error("Port is not open");
    await (0, q.asyncUpdate)(this.fd, r);
  }
  async set(r) {
    if (!r || typeof r != "object" || Array.isArray(r))
      throw new TypeError('"options" is not an object');
    if (A("set"), !this.isOpen)
      throw new Error("Port is not open");
    await (0, q.asyncSet)(this.fd, r);
  }
  async get() {
    if (A("get"), !this.isOpen)
      throw new Error("Port is not open");
    return (0, q.asyncGet)(this.fd);
  }
  async getBaudRate() {
    if (A("getBaudRate"), !this.isOpen)
      throw new Error("Port is not open");
    return (0, q.asyncGetBaudRate)(this.fd);
  }
  async flush() {
    if (A("flush"), !this.isOpen)
      throw new Error("Port is not open");
    await (0, q.asyncFlush)(this.fd);
  }
  async drain() {
    if (A("drain"), !this.isOpen)
      throw new Error("Port is not open");
    await this.writeOperation, await (0, q.asyncDrain)(this.fd);
  }
}
Z.LinuxPortBinding = Wt;
var H = {}, Te = {};
Object.defineProperty(Te, "__esModule", { value: !0 });
Te.serialNumParser = void 0;
const _n = [/USB\\(?:.+)\\(.+)/, /FTDIBUS\\(?:.+)\+(.+?)A?\\.+/], vn = (s) => {
  if (!s)
    return null;
  for (const r of _n) {
    const t = s.match(r);
    if (t)
      return t[1];
  }
  return null;
};
Te.serialNumParser = vn;
var Pt;
function Rt() {
  if (Pt) return H;
  Pt = 1;
  var s = v && v.__importDefault || function(h) {
    return h && h.__esModule ? h : { default: h };
  };
  Object.defineProperty(H, "__esModule", { value: !0 }), H.WindowsPortBinding = H.WindowsBinding = void 0;
  const r = s(K), t = Vt(), e = B, a = Te, c = (0, r.default)("serialport/bindings-cpp");
  H.WindowsBinding = {
    async list() {
      return (await (0, e.asyncList)()).map((o) => {
        if (o.pnpId && !o.serialNumber) {
          const d = (0, a.serialNumParser)(o.pnpId);
          if (d)
            return Object.assign(Object.assign({}, o), { serialNumber: d });
        }
        return o;
      });
    },
    async open(h) {
      if (!h || typeof h != "object" || Array.isArray(h))
        throw new TypeError('"options" is not an object');
      if (!h.path)
        throw new TypeError('"path" is not a valid port');
      if (!h.baudRate)
        throw new TypeError('"baudRate" is not a valid baudRate');
      c("open");
      const o = Object.assign({ dataBits: 8, lock: !0, stopBits: 1, parity: "none", rtscts: !1, rtsMode: "handshake", xon: !1, xoff: !1, xany: !1, hupcl: !0 }, h), d = await (0, e.asyncOpen)(o.path, o);
      return new f(d, o);
    }
  };
  class f {
    constructor(o, d) {
      this.fd = o, this.openOptions = d, this.writeOperation = null;
    }
    get isOpen() {
      return this.fd !== null;
    }
    async close() {
      if (c("close"), !this.isOpen)
        throw new Error("Port is not open");
      const o = this.fd;
      this.fd = null, await (0, e.asyncClose)(o);
    }
    async read(o, d, u) {
      if (!Buffer.isBuffer(o))
        throw new TypeError('"buffer" is not a Buffer');
      if (typeof d != "number" || isNaN(d))
        throw new TypeError(`"offset" is not an integer got "${isNaN(d) ? "NaN" : typeof d}"`);
      if (typeof u != "number" || isNaN(u))
        throw new TypeError(`"length" is not an integer got "${isNaN(u) ? "NaN" : typeof u}"`);
      if (c("read"), o.length < d + u)
        throw new Error("buffer is too small");
      if (!this.isOpen)
        throw new Error("Port is not open");
      try {
        return { bytesRead: await (0, e.asyncRead)(this.fd, o, d, u), buffer: o };
      } catch (i) {
        throw this.isOpen ? i : new t.BindingsError(i.message, { canceled: !0 });
      }
    }
    async write(o) {
      if (!Buffer.isBuffer(o))
        throw new TypeError('"buffer" is not a Buffer');
      if (c("write", o.length, "bytes"), !this.isOpen)
        throw c("write", "error port is not open"), new Error("Port is not open");
      return this.writeOperation = (async () => {
        o.length !== 0 && (await (0, e.asyncWrite)(this.fd, o), this.writeOperation = null);
      })(), this.writeOperation;
    }
    async update(o) {
      if (!o || typeof o != "object" || Array.isArray(o))
        throw TypeError('"options" is not an object');
      if (typeof o.baudRate != "number")
        throw new TypeError('"options.baudRate" is not a number');
      if (c("update"), !this.isOpen)
        throw new Error("Port is not open");
      await (0, e.asyncUpdate)(this.fd, o);
    }
    async set(o) {
      if (!o || typeof o != "object" || Array.isArray(o))
        throw new TypeError('"options" is not an object');
      if (c("set", o), !this.isOpen)
        throw new Error("Port is not open");
      await (0, e.asyncSet)(this.fd, o);
    }
    async get() {
      if (c("get"), !this.isOpen)
        throw new Error("Port is not open");
      return (0, e.asyncGet)(this.fd);
    }
    async getBaudRate() {
      if (c("getBaudRate"), !this.isOpen)
        throw new Error("Port is not open");
      return (0, e.asyncGetBaudRate)(this.fd);
    }
    async flush() {
      if (c("flush"), !this.isOpen)
        throw new Error("Port is not open");
      await (0, e.asyncFlush)(this.fd);
    }
    async drain() {
      if (c("drain"), !this.isOpen)
        throw new Error("Port is not open");
      await this.writeOperation, await (0, e.asyncDrain)(this.fd);
    }
  }
  return H.WindowsPortBinding = f, H;
}
var En = {}, Nt;
function Vt() {
  return Nt || (Nt = 1, function(s) {
    var r = v && v.__createBinding || (Object.create ? function(u, i, n, l) {
      l === void 0 && (l = n);
      var p = Object.getOwnPropertyDescriptor(i, n);
      (!p || ("get" in p ? !i.__esModule : p.writable || p.configurable)) && (p = { enumerable: !0, get: function() {
        return i[n];
      } }), Object.defineProperty(u, l, p);
    } : function(u, i, n, l) {
      l === void 0 && (l = n), u[l] = i[n];
    }), t = v && v.__exportStar || function(u, i) {
      for (var n in u) n !== "default" && !Object.prototype.hasOwnProperty.call(i, n) && r(i, u, n);
    }, e = v && v.__importDefault || function(u) {
      return u && u.__esModule ? u : { default: u };
    };
    Object.defineProperty(s, "__esModule", { value: !0 }), s.autoDetect = void 0;
    const a = e(K), c = J, f = Z, h = Rt(), o = (0, a.default)("serialport/bindings-cpp");
    t(En, s), t(J, s), t(Z, s), t(Rt(), s), t(ee, s);
    function d() {
      switch (process.platform) {
        case "win32":
          return o("loading WindowsBinding"), h.WindowsBinding;
        case "darwin":
          return o("loading DarwinBinding"), c.DarwinBinding;
        default:
          return o("loading LinuxBinding"), f.LinuxBinding;
      }
    }
    s.autoDetect = d;
  }(ke)), ke;
}
Object.defineProperty(Fe, "__esModule", { value: !0 });
Fe.SerialPort = void 0;
const On = z, Bn = Vt(), Ve = (0, Bn.autoDetect)();
class Ye extends On.SerialPortStream {
  constructor(r, t) {
    const e = {
      binding: Ve,
      ...r
    };
    super(e, t);
  }
}
g(Ye, "list", Ve.list), g(Ye, "binding", Ve);
Fe.SerialPort = Ye;
(function(s) {
  var r = v && v.__createBinding || (Object.create ? function(e, a, c, f) {
    f === void 0 && (f = c);
    var h = Object.getOwnPropertyDescriptor(a, c);
    (!h || ("get" in h ? !a.__esModule : h.writable || h.configurable)) && (h = { enumerable: !0, get: function() {
      return a[c];
    } }), Object.defineProperty(e, f, h);
  } : function(e, a, c, f) {
    f === void 0 && (f = c), e[f] = a[c];
  }), t = v && v.__exportStar || function(e, a) {
    for (var c in e) c !== "default" && !Object.prototype.hasOwnProperty.call(a, c) && r(a, e, c);
  };
  Object.defineProperty(s, "__esModule", { value: !0 }), t(me, s), t(we, s), t(te, s), t(ge, s), t(ye, s), t(be, s), t(Ce, s), t(_e, s), t(jt, s), t(Oe, s), t(Be, s), t(Fe, s);
})(tt);
var ot = {}, De = {};
Object.defineProperty(De, "__esModule", { value: !0 });
De.DelimiterParser = void 0;
const Fn = $;
class Pn extends Fn.Transform {
  constructor({ delimiter: t, includeDelimiter: e = !1, ...a }) {
    super(a);
    g(this, "includeDelimiter");
    g(this, "delimiter");
    g(this, "buffer");
    if (t === void 0)
      throw new TypeError('"delimiter" is not a bufferable object');
    if (t.length === 0)
      throw new TypeError('"delimiter" has a 0 or undefined length');
    this.includeDelimiter = e, this.delimiter = Buffer.from(t), this.buffer = Buffer.alloc(0);
  }
  _transform(t, e, a) {
    let c = Buffer.concat([this.buffer, t]), f;
    for (; (f = c.indexOf(this.delimiter)) !== -1; )
      this.push(c.slice(0, f + (this.includeDelimiter ? this.delimiter.length : 0))), c = c.slice(f + this.delimiter.length);
    this.buffer = c, a();
  }
  _flush(t) {
    this.push(this.buffer), this.buffer = Buffer.alloc(0), t();
  }
}
De.DelimiterParser = Pn;
Object.defineProperty(ot, "__esModule", { value: !0 });
var Gt = ot.ReadlineParser = void 0;
const Rn = De;
class Nn extends Rn.DelimiterParser {
  constructor(r) {
    const t = {
      delimiter: Buffer.from(`
`, "utf8"),
      encoding: "utf8",
      ...r
    };
    typeof t.delimiter == "string" && (t.delimiter = Buffer.from(t.delimiter, t.encoding)), super(t);
  }
}
Gt = ot.ReadlineParser = Nn;
const Tt = Q.dirname(tr(import.meta.url));
let M = null, L = null, Qe = null;
const Dt = process.env.VITE_DEV_SERVER_URL;
function Ht() {
  M = new St({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: Q.join(Tt, "preload.js"),
      contextIsolation: !0,
      nodeIntegration: !1
    }
  }), Dt ? (M.loadURL(Dt), M.webContents.openDevTools()) : M.loadFile(Q.join(Tt, "../dist/index.html")), M.on("closed", () => {
    M = null;
  });
}
he.whenReady().then(Ht);
he.on("window-all-closed", () => {
  process.platform !== "darwin" && he.quit();
});
he.on("activate", () => {
  St.getAllWindows().length === 0 && Ht();
});
pe.handle("serial:list-ports", async () => {
  try {
    return {
      success: !0,
      ports: (await tt.SerialPort.list()).map((r) => ({
        path: r.path,
        manufacturer: r.manufacturer,
        serialNumber: r.serialNumber,
        productId: r.productId,
        vendorId: r.vendorId
      }))
    };
  } catch (s) {
    return {
      success: !1,
      error: s instanceof Error ? s.message : "Unknown error"
    };
  }
});
pe.handle("serial:connect", async (s, r) => {
  try {
    return L && L.isOpen && L.close(), L = new tt.SerialPort({
      path: r.path,
      baudRate: r.baudRate,
      dataBits: r.dataBits,
      stopBits: r.stopBits,
      parity: r.parity
    }), Qe = L.pipe(new Gt({ delimiter: `\r
` })), Qe.on("data", (t) => {
      const e = Tn(t);
      e !== null && M && M.webContents.send("serial:weight-data", e);
    }), L.on("error", (t) => {
      M && M.webContents.send("serial:error", t.message);
    }), { success: !0 };
  } catch (t) {
    return {
      success: !1,
      error: t instanceof Error ? t.message : "Unknown error"
    };
  }
});
pe.handle("serial:disconnect", async () => {
  try {
    return L && L.isOpen && (L.close(), L = null, Qe = null), { success: !0 };
  } catch (s) {
    return {
      success: !1,
      error: s instanceof Error ? s.message : "Unknown error"
    };
  }
});
pe.handle("serial:simulate-weight", async (s, r) => M ? (M.webContents.send("serial:weight-data", r), { success: !0 }) : { success: !1, error: "Window not found" });
function Tn(s) {
  const r = s.trim().replace(/[^\d.-]/g, ""), t = parseFloat(r);
  return isNaN(t) ? null : t;
}
