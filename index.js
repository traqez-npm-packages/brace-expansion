import balanced from 'balanced-match'

const escSlash = '\0SLASH' + Math.random() + '\0'
const escOpen = '\0OPEN' + Math.random() + '\0'
const escClose = '\0CLOSE' + Math.random() + '\0'
const escComma = '\0COMMA' + Math.random() + '\0'
const escPeriod = '\0PERIOD' + Math.random() + '\0'
const escSlashPattern = new RegExp(escSlash, 'g')
const escOpenPattern = new RegExp(escOpen, 'g')
const escClosePattern = new RegExp(escClose, 'g')
const escCommaPattern = new RegExp(escComma, 'g')
const escPeriodPattern = new RegExp(escPeriod, 'g')
const slashPattern = /\\\\/g
const openPattern = /\\{/g
const closePattern = /\\}/g
const commaPattern = /\\,/g
const periodPattern = /\\./g

/**
 * @return {number}
 */
function numeric (str) {
  return !isNaN(str)
    ? parseInt(str, 10)
    : str.charCodeAt(0)
}

/**
 * @param {string} str
 */
function escapeBraces (str) {
  return str.replace(slashPattern, escSlash)
    .replace(openPattern, escOpen)
    .replace(closePattern, escClose)
    .replace(commaPattern, escComma)
    .replace(periodPattern, escPeriod)
}

/**
 * @param {string} str
 */
function unescapeBraces (str) {
  return str.replace(escSlashPattern, '\\')
    .replace(escOpenPattern, '{')
    .replace(escClosePattern, '}')
    .replace(escCommaPattern, ',')
    .replace(escPeriodPattern, '.')
}

/**
 * Basically just str.split(","), but handling cases
 * where we have nested braced sections, which should be
 * treated as individual members, like {a,{b,c},d}
 * @param {string} str
 */
function parseCommaParts (str) {
  if (!str) { return [''] }

  const parts = []
  const m = balanced('{', '}', str)

  if (!m) { return str.split(',') }

  const { pre, body, post } = m
  const p = pre.split(',')

  p[p.length - 1] += '{' + body + '}'
  const postParts = parseCommaParts(post)
  if (post.length) {
    p[p.length - 1] += postParts.shift()
    p.push.apply(p, postParts)
  }

  parts.push.apply(parts, p)

  return parts
}

/**
 * @param {string} str
 */
export default function expandTop (str) {
  if (!str) { return [] }

  // I don't know why Bash 4.3 does this, but it does.
  // Anything starting with {} will have the first two bytes preserved
  // but *only* at the top level, so {},a}b will not expand to anything,
  // but a{},b}c will be expanded to [a}c,abc].
  // One could argue that this is a bug in Bash, but since the goal of
  // this module is to match Bash's rules, we escape a leading {}
  if (str.slice(0, 2) === '{}') {
    str = '\\{\\}' + str.slice(2)
  }

  return expand(escapeBraces(str), true).map(unescapeBraces)
}

/**
 * @param {string} str
 */
function embrace (str) {
  return '{' + str + '}'
}

/**
 * @param {string} el
 */
function isPadded (el) {
  return /^-?0\d/.test(el)
}

/**
 * @param {number} i
 * @param {number} y
 */
function lte (i, y) {
  return i <= y
}

/**
 * @param {number} i
 * @param {number} y
 */
function gte (i, y) {
  return i >= y
}

/**
 * @param {string} str
 * @param {boolean} [isTop]
 */
function expand (str, isTop) {
  /** @type {string[]} */
  const expansions = []

  const m = balanced('{', '}', str)
  if (!m) return [str]

  // no need to expand pre, since it is guaranteed to be free of brace-sets
  const pre = m.pre
  const post = m.post.length
    ? expand(m.post, false)
    : ['']

  if (/\$$/.test(m.pre)) {
    for (let k = 0; k < post.length; k++) {
      const expansion = pre + '{' + m.body + '}' + post[k]
      expansions.push(expansion)
    }
  } else {
    const isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body)
    const isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body)
    const isSequence = isNumericSequence || isAlphaSequence
    const isOptions = m.body.indexOf(',') >= 0
    if (!isSequence && !isOptions) {
      // {a},b}
      // Fixes the bug at: https://github.com/advisories/GHSA-v6h2-p8h4-qcjw
      // Refer: https://github.com/juliangruber/brace-expansion/pull/65/commits/a5b98a4f30d7813266b221435e1eaaf25a1b0ac5
      // if (m.post.match(/,.*\}/)) {
        if (m.post.match(/,(?!,).*\}/)) {
          str = m.pre + '{' + m.body + escClose + m.post
          return expand(str)
        }
    }

    let n
    if (isSequence) {
      n = m.body.split(/\.\./)
    } else {
      n = parseCommaParts(m.body)
      if (n.length === 1) {
        // x{{a,b}}y ==> x{a}y x{b}y
        n = expand(n[0], false).map(embrace)
        if (n.length === 1) {
          return post.map(function (p) {
            return m.pre + n[0] + p
          })
        }
      }
    }

    // at this point, n is the parts, and we know it's not a comma set
    // with a single entry.
    let N

    if (isSequence) {
      const x = numeric(n[0])
      const y = numeric(n[1])
      const width = Math.max(n[0].length, n[1].length)
      let incr = n.length === 3
        ? Math.abs(numeric(n[2]))
        : 1
      let test = lte
      const reverse = y < x
      if (reverse) {
        incr *= -1
        test = gte
      }
      const pad = n.some(isPadded)

      N = []

      for (let i = x; test(i, y); i += incr) {
        let c
        if (isAlphaSequence) {
          c = String.fromCharCode(i)
          if (c === '\\') { c = '' }
        } else {
          c = String(i)
          if (pad) {
            const need = width - c.length
            if (need > 0) {
              const z = new Array(need + 1).join('0')
              if (i < 0) { c = '-' + z + c.slice(1) } else { c = z + c }
            }
          }
        }
        N.push(c)
      }
    } else {
      N = []

      for (let j = 0; j < n.length; j++) {
        N.push.apply(N, expand(n[j], false))
      }
    }

    for (let j = 0; j < N.length; j++) {
      for (let k = 0; k < post.length; k++) {
        const expansion = pre + N[j] + post[k]
        if (!isTop || isSequence || expansion) { expansions.push(expansion) }
      }
    }
  }

  return expansions
}
