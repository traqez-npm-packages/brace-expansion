"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = expandTop;
var _balancedMatch = _interopRequireDefault(require("balanced-match"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }
var escSlash = '\0SLASH' + Math.random() + '\0';
var escOpen = '\0OPEN' + Math.random() + '\0';
var escClose = '\0CLOSE' + Math.random() + '\0';
var escComma = '\0COMMA' + Math.random() + '\0';
var escPeriod = '\0PERIOD' + Math.random() + '\0';
var escSlashPattern = new RegExp(escSlash, 'g');
var escOpenPattern = new RegExp(escOpen, 'g');
var escClosePattern = new RegExp(escClose, 'g');
var escCommaPattern = new RegExp(escComma, 'g');
var escPeriodPattern = new RegExp(escPeriod, 'g');
var slashPattern = /\\\\/g;
var openPattern = /\\{/g;
var closePattern = /\\}/g;
var commaPattern = /\\,/g;
var periodPattern = /\\./g;

/**
 * @return {number}
 */
function numeric(str) {
  return !isNaN(str) ? parseInt(str, 10) : str.charCodeAt(0);
}

/**
 * @param {string} str
 */
function escapeBraces(str) {
  return str.replace(slashPattern, escSlash).replace(openPattern, escOpen).replace(closePattern, escClose).replace(commaPattern, escComma).replace(periodPattern, escPeriod);
}

/**
 * @param {string} str
 */
function unescapeBraces(str) {
  return str.replace(escSlashPattern, '\\').replace(escOpenPattern, '{').replace(escClosePattern, '}').replace(escCommaPattern, ',').replace(escPeriodPattern, '.');
}

/**
 * Basically just str.split(","), but handling cases
 * where we have nested braced sections, which should be
 * treated as individual members, like {a,{b,c},d}
 * @param {string} str
 */
function parseCommaParts(str) {
  if (!str) {
    return [''];
  }
  var parts = [];
  var m = (0, _balancedMatch["default"])('{', '}', str);
  if (!m) {
    return str.split(',');
  }
  var pre = m.pre,
    body = m.body,
    post = m.post;
  var p = pre.split(',');
  p[p.length - 1] += '{' + body + '}';
  var postParts = parseCommaParts(post);
  if (post.length) {
    p[p.length - 1] += postParts.shift();
    p.push.apply(p, postParts);
  }
  parts.push.apply(parts, p);
  return parts;
}

/**
 * @param {string} str
 */
function expandTop(str) {
  if (!str) {
    return [];
  }

  // I don't know why Bash 4.3 does this, but it does.
  // Anything starting with {} will have the first two bytes preserved
  // but *only* at the top level, so {},a}b will not expand to anything,
  // but a{},b}c will be expanded to [a}c,abc].
  // One could argue that this is a bug in Bash, but since the goal of
  // this module is to match Bash's rules, we escape a leading {}
  if (str.slice(0, 2) === '{}') {
    str = '\\{\\}' + str.slice(2);
  }
  return expand(escapeBraces(str), true).map(unescapeBraces);
}

/**
 * @param {string} str
 */
function embrace(str) {
  return '{' + str + '}';
}

/**
 * @param {string} el
 */
function isPadded(el) {
  return /^-?0\d/.test(el);
}

/**
 * @param {number} i
 * @param {number} y
 */
function lte(i, y) {
  return i <= y;
}

/**
 * @param {number} i
 * @param {number} y
 */
function gte(i, y) {
  return i >= y;
}

/**
 * @param {string} str
 * @param {boolean} [isTop]
 */
function expand(str, isTop) {
  /** @type {string[]} */
  var expansions = [];
  var m = (0, _balancedMatch["default"])('{', '}', str);
  if (!m) return [str];

  // no need to expand pre, since it is guaranteed to be free of brace-sets
  var pre = m.pre;
  var post = m.post.length ? expand(m.post, false) : [''];
  if (/\$$/.test(m.pre)) {
    for (var k = 0; k < post.length; k++) {
      var expansion = pre + '{' + m.body + '}' + post[k];
      expansions.push(expansion);
    }
  } else {
    var isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
    var isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
    var isSequence = isNumericSequence || isAlphaSequence;
    var isOptions = m.body.indexOf(',') >= 0;
    if (!isSequence && !isOptions) {
      // {a},b}
      // Fixes the bug at: https://github.com/advisories/GHSA-v6h2-p8h4-qcjw
      // Refer: https://github.com/juliangruber/brace-expansion/pull/65/commits/a5b98a4f30d7813266b221435e1eaaf25a1b0ac5
      // if (m.post.match(/,.*\}/)) {
      if (m.post.match(/,(?!,).*\}/)) {
        str = m.pre + '{' + m.body + escClose + m.post;
        return expand(str);
      }
    }
    var n;
    if (isSequence) {
      n = m.body.split(/\.\./);
    } else {
      n = parseCommaParts(m.body);
      if (n.length === 1) {
        // x{{a,b}}y ==> x{a}y x{b}y
        n = expand(n[0], false).map(embrace);
        if (n.length === 1) {
          return post.map(function (p) {
            return m.pre + n[0] + p;
          });
        }
      }
    }

    // at this point, n is the parts, and we know it's not a comma set
    // with a single entry.
    var N;
    if (isSequence) {
      var x = numeric(n[0]);
      var y = numeric(n[1]);
      var width = Math.max(n[0].length, n[1].length);
      var incr = n.length === 3 ? Math.abs(numeric(n[2])) : 1;
      var test = lte;
      var reverse = y < x;
      if (reverse) {
        incr *= -1;
        test = gte;
      }
      var pad = n.some(isPadded);
      N = [];
      for (var i = x; test(i, y); i += incr) {
        var c = void 0;
        if (isAlphaSequence) {
          c = String.fromCharCode(i);
          if (c === '\\') {
            c = '';
          }
        } else {
          c = String(i);
          if (pad) {
            var need = width - c.length;
            if (need > 0) {
              var z = new Array(need + 1).join('0');
              if (i < 0) {
                c = '-' + z + c.slice(1);
              } else {
                c = z + c;
              }
            }
          }
        }
        N.push(c);
      }
    } else {
      N = [];
      for (var j = 0; j < n.length; j++) {
        N.push.apply(N, expand(n[j], false));
      }
    }
    for (var _j = 0; _j < N.length; _j++) {
      for (var _k = 0; _k < post.length; _k++) {
        var _expansion = pre + N[_j] + post[_k];
        if (!isTop || isSequence || _expansion) {
          expansions.push(_expansion);
        }
      }
    }
  }
  return expansions;
}