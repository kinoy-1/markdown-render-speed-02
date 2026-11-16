// parse.js — a fast CommonMark 0.31.2 + GFM renderer.
//
// parse(markdown) returns exactly the HTML that marked 18.1.3 renders with
// its default options (gfm on, breaks off, pedantic off, async off).
// Dependency-free ES module. Written from the CommonMark 0.31.2 and GFM 0.29
// specifications, with marked's observable behaviour as the arbiter wherever
// the two differ (marked's output is the expected output, never the spec's).
//
// Layout: a line-based block parser builds a small node tree (link reference
// definitions are collected as blocks are read), then each text span is run
// through a single-pass inline scanner with a delimiter stack for emphasis
// and strikethrough matched directly, the way marked's own tokenizer does.

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

const C_SPACE = 32, C_TAB = 9, C_LF = 10, C_CR = 13;
const C_LT = 60, C_GT = 62, C_AMP = 38, C_QUOT = 34, C_SQ = 39;
const C_BSLASH = 92, C_BTICK = 96, C_STAR = 42, C_UNDER = 95;
const C_TILDE = 126, C_LBR = 91, C_RBR = 93, C_LP = 40;
const C_RP = 41, C_BANG = 33, C_HASH = 35, C_DASH = 45;
const C_DOT = 46, C_COLON = 58, C_SLASH = 47, C_AT = 64;

// Document-persistent "inside a link" flag (marked's inline Lexer state).
// An unclosed inline <a ...> tag sets it; a </a> clears it. While set,
// extended autolinks (bare email, bare URL, www.) are suppressed in
// subsequent paragraphs (marked quirk: the state leaks across blocks
// until a </a> appears; explicit [text](url) links, <...> autolinks and
// images are NOT suppressed). HTML blocks do not touch it. Reset at the
// start of every parse() and before the rendering pass.
let inLink = false;

// Classify an inline HTML tag: 'open' for <a ...>, 'close' for </a ...>,
// null otherwise (case-insensitive; <abbr> is not <a>).
function anchorTagKind(tag) {
  let k = 1, close = false;
  if (tag.charCodeAt(1) === C_SLASH) { close = true; k = 2; }
  if (k >= tag.length) return null;
  const c = tag.charCodeAt(k);
  if (c !== 97 && c !== 65) return null;
  if (k + 1 >= tag.length) return null;
  const nx = tag.charCodeAt(k + 1);
  if (nx === C_SPACE || nx === C_TAB || nx === C_LF || nx === C_CR || nx === C_GT || nx === C_SLASH) {
    return close ? 'close' : 'open';
  }
  return null;
}

function isSpaceCh(c) { return c === C_SPACE || c === C_TAB || c === C_LF || c === C_CR; }
function isAsciiPunctCh(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}
function isDigitCh(c) { return c >= 48 && c <= 57; }
function isAlnumCh(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isHexCh(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}
// Unicode whitespace per CommonMark (space, tab, LF, FF, CR and the usual
// Unicode spaces).
function isUniWs(c) {
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13 ||
    c === 0x00a0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f ||
    c === 0x3000 || c === 0xfeff;
}
// Unicode punctuation (approximation for the flanking test): ASCII
// punctuation plus the common Unicode punctuation and symbol ranges.
function isPunctCh(c) {
  if (c < 128) return isAsciiPunctCh(c);
  return (c >= 0x2000 && c <= 0x206f) || (c >= 0x3000 && c <= 0x303f) ||
    (c >= 0xff00 && c <= 0xff0f) || (c >= 0xff1a && c <= 0xff20) ||
    (c >= 0xff3b && c <= 0xff40) || (c >= 0xff5b && c <= 0xff65) ||
    (c >= 0x00a2 && c <= 0x00a5) || c === 0x00a6 || c === 0x00a9 ||
    c === 0x00ae || c === 0x00b0 || c === 0x00b1 || c === 0x00d7 ||
    c === 0x00f7 || (c >= 0x20a0 && c <= 0x20bf) ||
    (c >= 0x2190 && c <= 0x21ff) || (c >= 0x2200 && c <= 0x22ff) ||
    (c >= 0x2300 && c <= 0x23ff) || (c >= 0x2460 && c <= 0x24ff) ||
    (c >= 0x2500 && c <= 0x25ff) || (c >= 0x2600 && c <= 0x26ff) ||
    (c >= 0x2700 && c <= 0x27bf) || (c >= 0x2900 && c <= 0x2aff) ||
    (c >= 0x2b00 && c <= 0x2bff) || c === 0x00a1 || c === 0x00a7 || c === 0x00ab || c === 0x00bb ||
    c === 0x00bf || c === 0x037e || c === 0x0387 || c === 0x055a ||
    (c >= 0x055b && c <= 0x055f) || c === 0x0589 || c === 0x058a ||
    (c >= 0x05be && c <= 0x05c0) || c === 0x05c3 || c === 0x05c6 ||
    (c >= 0x05f3 && c <= 0x05f4) || c === 0x0609 || c === 0x060a ||
    (c >= 0x060c && c <= 0x060d) || c === 0x061b || c === 0x061e ||
    c === 0x061f || (c >= 0x066a && c <= 0x066d) || c === 0x06d4 ||
    (c >= 0x06dd && c <= 0x06de) || c === 0x0700 || (c >= 0x0701 && c <= 0x070a) ||
    (c >= 0x070c && c <= 0x070d) || c === 0x07f7 || (c >= 0x07f8 && c <= 0x07f9) ||
    (c >= 0x085e && c <= 0x085f) || c === 0x08e2;
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

// Escape text content: & < > " ' (marked escapes " as &quot; and ' as &#39;).
function escapeText(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === C_AMP) rep = '&amp;';
    else if (c === C_LT) rep = '&lt;';
    else if (c === C_GT) rep = '&gt;';
    else if (c === C_QUOT) rep = '&quot;';
    else if (c === C_SQ) rep = '&#39;';
    if (rep !== null) {
      out += s.slice(start, i) + rep;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  return out + s.slice(start);
}

// Fence info string: unescape backslash escapes, escape < > " only
// (NOT & — marked keeps entities as-is in the language class, cm-034).
function escapeInfo(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { out += s[i + 1]; i++; }
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '"') out += '&quot;';
    else out += c;
  }
  return out;
}

// Escape attribute values (href / title): & < > " and '.
// A '&' that starts a named entity (&name;) is left alone (marked passes
// named entities through in attributes, as in text).
function escapeAttr(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === C_AMP) {
      const e = namedEntityEnd(s, i);
      if (e !== -1) { out += s.slice(start, e); start = e; i = e - 1; continue; }
      rep = '&amp;';
    }
    else if (c === C_LT) rep = '&lt;';
    else if (c === C_GT) rep = '&gt;';
    else if (c === C_QUOT) rep = '&quot;';
    else if (c === C_SQ) rep = '&#39;';
    if (rep !== null) {
      out += s.slice(start, i) + rep;
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
//
// marked's rule (verified against its own spec examples):
// - Numeric entities &#123; / &#xAB; are DECODED to the character (0 and
//   surrogates become U+FFFD; values above 0x10FFFF are not entities).
// - Named entities &name; are passed through UNCHANGED (no HTML5 table,
//   no validation): any &[A-Za-z][A-Za-z0-9]*; is emitted as-is.
// - Anything else starting with & is literal: the & is escaped to &amp;.

// Decode one numeric entity starting at s[i] === '&'. Returns [char, end]
// or null when s[i..] is not a valid numeric entity.
function decodeNumericEntity(s, i) {
  let j = i + 2; // s[i] === '&', s[i+1] === '#'
  let hex = false;
  if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
  const ds = j;
  if (hex) { while (j < s.length && isHexCh(s.charCodeAt(j))) j++; }
  else { while (j < s.length && isDigitCh(s.charCodeAt(j))) j++; }
  if (j === ds || j >= s.length || s[j] !== ';') return null;
  const n = parseInt(s.slice(ds, j), hex ? 16 : 10);
  if (n > 0x10ffff) return null;
  let ch;
  if (n === 0 || (n >= 0xd800 && n <= 0xdfff)) ch = '\uFFFD';
  else ch = String.fromCodePoint(n);
  return [ch, j + 1];
}

// Scan a named entity starting at s[i] === '&'. Returns the end index
// (exclusive) when s[i..] is &[A-Za-z][A-Za-z0-9]*; , else -1.
function namedEntityEnd(s, i) {
  let j = i + 1;
  if (j >= s.length) return -1;
  const c0 = s.charCodeAt(j);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return -1;
  j++;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { j++; continue; }
    break;
  }
  if (j < s.length && s[j] === ';') return j + 1;
  return -1;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

// Encode a link destination the way marked does: percent-encode characters
// that must not appear raw in an href, but leave the URL otherwise alone.
function encodeHref(raw) {
  let out = '';
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    let rep = null;
    if (c <= 32 || c === 127) rep = '%' + c.toString(16).toUpperCase().padStart(2, '0');
    else if (c === 34) rep = '%22';
    else if (c === 60) rep = '%3C';
    else if (c === 62) rep = '%3E';
    else if (c === 96) rep = '%60';
    else if (c === 123) rep = '%7B';
    else if (c === 124) rep = '%7C';
    else if (c === 125) rep = '%7D';
    else if (c === 94) rep = '%5E';
    else if (c === 91) rep = '%5B';
    else if (c === 93) rep = '%5D';
    else if (c === 92) rep = '%5C';
    else if (c > 127) {
      // percent-encode as UTF-8 bytes (handles surrogate pairs)
      let cp = c;
      let adv = 1;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < raw.length) {
        const lo = raw.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) { cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); adv = 2; }
      }
      let bytes;
      if (cp < 0x800) bytes = [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
      else if (cp < 0x10000) bytes = [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
      else bytes = [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
      rep = bytes.map(b => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
      out += raw.slice(start, i) + rep;
      start = i + adv;
      i += adv - 1;
      continue;
    }
    if (rep !== null) {
      out += raw.slice(start, i) + rep;
      start = i + 1;
    }
  }
  return start === 0 ? raw : out + raw.slice(start);
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------
//
// Node types (numeric for speed); every node carries p, its source index in
// the string it was tokenized from (used to rewind text when an email
// autolink's local part reaches back past already-emitted nodes):
//   0 text    {t:0, s, p}
//   1 delim   {t:1, ch, len, open, close, p}  // * or _ emphasis run
//   2 code    {t:2, s, p}                      // code span (raw content)
//   3 link    {t:3, href, title, children, p}
//   4 image   {t:4, src, title, alt, p}
//   5 html    {t:5, s, p}                      // raw inline HTML / entity
//   6 br      {t:6, p}                         // hard break
//   7 em      {t:7, children}
//   8 strong  {t:8, children}
//   9 del     {t:9, children}                  // strikethrough

// Normalize a link reference label: collapse whitespace, lowercase.
// IMPORTANT: backslash escapes and entities are NOT resolved here — marked
// compares labels as written (only case and whitespace are normalized), so
// [foo\!] does not match a definition for [foo!].
function normalizeLabel(s) {
  let out = '';
  let ws = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isUniWs(c)) {
      if (!ws && out.length > 0) { out += ' '; ws = true; }
    } else if (c === 0x00df || c === 0x1e9e) {
      // Unicode case folding: ß / ẞ fold to "ss"
      out += 'ss';
      ws = false;
    } else {
      out += String.fromCharCode(c).toLowerCase();
      ws = false;
    }
  }
  if (out.charCodeAt(out.length - 1) === 32) out = out.slice(0, -1);
  return out;
}

// Parse a link destination + optional title starting at s[i] === '('.
// Returns {href, title, end} (end = index after ')') or null.
function parseLinkParens(s, i) {
  const n = s.length;
  let j = i + 1;
  while (j < n && isSpaceCh(s.charCodeAt(j))) j++;
  if (j >= n) return null;
  let href = '';
  if (s[j] === '<') {
    // <destination>: backslash escapes are honoured (a \> does not close)
    let k = j + 1;
    let close = -1;
    while (k < n) {
      const c = s.charCodeAt(k);
      if (c === C_BSLASH) { k += 2; continue; }
      if (c === C_GT) { close = k; break; }
      if (c === C_LT || c === C_LF || c === C_CR) return null;
      k++;
    }
    if (close === -1) return null;
    href = s.slice(j + 1, close);
    j = close + 1;
  } else {
    // bare destination: no spaces, balanced parens allowed; backslash
    // escapes do not count for balancing
    let depth = 0;
    const ds = j;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === C_BSLASH) { j += 2; continue; }
      if (c === C_SPACE || c === C_TAB || c === C_LF || c === C_CR) break;
      if (c === C_LP) depth++;
      else if (c === C_RP) {
        if (depth === 0) break;
        depth--;
      } else if (c < 32) return null;
      j++;
    }
    if (j === ds && s[j] !== ')') return null;
    href = s.slice(ds, j);
  }
  while (j < n && isSpaceCh(s.charCodeAt(j))) j++;
  let title = null;
  if (j < n && s[j] !== ')') {
    const tq = parseTitle(s, j);
    if (!tq) return null;
    title = tq.title;
    j = tq.end;
    while (j < n && isSpaceCh(s.charCodeAt(j))) j++;
  }
  if (j >= n || s[j] !== ')') return null;
  return { href, title, end: j + 1 };
}

// Parse a link title starting at s[i]: "..." or '...' or (...).
// Returns {title, end} (end = index after the closing quote/paren) or null.
function parseTitle(s, i) {
  const n = s.length;
  const q = s.charCodeAt(i);
  if (q === 34) { // "
    let j = i + 1;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === C_BSLASH && j + 1 < n) { j += 2; continue; }
      if (c === 34) return { title: s.slice(i + 1, j), end: j + 1 };
      j++;
    }
    return null;
  }
  if (q === 39) { // '
    let j = i + 1;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === C_BSLASH && j + 1 < n) { j += 2; continue; }
      if (c === 39) return { title: s.slice(i + 1, j), end: j + 1 };
      // a newline inside a single-quoted title is allowed only when it is
      // not followed by another newline (no blank line)
      if (c === C_LF && j + 1 < n && s.charCodeAt(j + 1) === C_LF) return null;
      j++;
    }
    return null;
  }
  if (q === C_LP) { // (
    let j = i + 1;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === C_BSLASH && j + 1 < n) { j += 2; continue; }
      if (c === C_RP) return { title: s.slice(i + 1, j), end: j + 1 };
      if (c === C_LP) return null; // a nested ( is not allowed
      j++;
    }
    return null;
  }
  return null;
}

// Does s contain an unescaped '['? (A '[' preceded by an odd run of
// backslashes is escaped; a double backslash does not escape it.)
function hasUnescapedBracket(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === C_BSLASH) { i++; continue; }
    if (c === C_LBR) return true;
  }
  return false;
}

// Try to parse a link reference definition starting at lines[idx]:
//   [label]: destination "optional title"
// Marked's def rule (the live one): the label may span lines (single
// newlines only, no blank line, no unescaped [ or ]); the destination
// may be on the next line; the title may span lines and may be on the
// line after the destination; the title must be preceded by whitespace
// (a destination followed immediately by a title-looking char is NOT a
// definition, cm-201). Returns {label, href, title, next} (next = index
// after the last line used), or null when lines[idx] does not start a
// definition.
function tryLinkRefDef(lines, idx) {
  const src = lines.slice(idx).join('\n');
  const n = src.length;
  let p = 0;
  // indent 0-3 spaces
  let ind = 0;
  while (p < n && src.charCodeAt(p) === C_SPACE && ind < 4) { ind++; p++; }
  if (ind > 3) return null;
  if (p >= n || src.charCodeAt(p) !== C_LBR) return null;
  p++;
  // empty-label lookahead: (?!\s*\])
  {
    let q = p;
    while (q < n && (src.charCodeAt(q) === C_SPACE || src.charCodeAt(q) === C_TAB || src.charCodeAt(q) === C_LF)) q++;
    if (q < n && src.charCodeAt(q) === C_RBR) return null;
  }
  // label: (?:\\[\s\S]|[^\[\]\\n]|\n(?![ \t]*\n))+
  const labelStart = p;
  let labelEnd = -1;
  while (p < n) {
    const c = src.charCodeAt(p);
    if (c === C_BSLASH && p + 1 < n) { p += 2; continue; }
    if (c === C_LBR) break;
    if (c === C_RBR) { labelEnd = p; break; }
    if (c === C_LF) {
      let q = p + 1;
      while (q < n && (src.charCodeAt(q) === C_SPACE || src.charCodeAt(q) === C_TAB)) q++;
      if (q < n && src.charCodeAt(q) === C_LF) return null; // blank line in label
      if (q >= n) return null;
      p++;
      continue;
    }
    p++;
  }
  if (labelEnd === -1) return null;
  const label = src.slice(labelStart, labelEnd);
  if (label.trim() === '' || label.length > 999) return null;
  p = labelEnd + 1;
  if (p >= n || src.charCodeAt(p) !== 58) return null; // ':'
  p++;
  // spaces after ':'
  while (p < n && (src.charCodeAt(p) === C_SPACE || src.charCodeAt(p) === C_TAB)) p++;
  // optional newline + spaces (destination on the next line)
  if (p < n && src.charCodeAt(p) === C_LF) {
    p++;
    while (p < n && (src.charCodeAt(p) === C_SPACE || src.charCodeAt(p) === C_TAB)) p++;
  }
  if (p >= n) return null;
  // destination: <...> (one line) or a run of non-space chars
  let href;
  if (src.charCodeAt(p) === C_LT) {
    const end = src.indexOf('>', p + 1);
    if (end === -1) return null;
    const nl = src.indexOf('\n', p);
    if (nl !== -1 && nl < end) return null; // <...> must not cross a line
    href = src.slice(p + 1, end);
    p = end + 1;
  } else {
    if (isSpaceCh(src.charCodeAt(p))) return null;
    let e = p;
    while (e < n && !isSpaceCh(src.charCodeAt(e))) e++;
    href = src.slice(p, e);
    p = e;
  }
  // optional title, preceded by whitespace (spaces, optionally a newline)
  let title = null;
  let titleEndPos = p;
  {
    let q = p;
    let crossedNewline = false;
    while (q < n && (src.charCodeAt(q) === C_SPACE || src.charCodeAt(q) === C_TAB)) q++;
    if (q < n && src.charCodeAt(q) === C_LF) {
      crossedNewline = true;
      q++;
      while (q < n && (src.charCodeAt(q) === C_SPACE || src.charCodeAt(q) === C_TAB)) q++;
    }
    // a title must be preceded by whitespace: a title-looking char
    // directly after the destination is junk, not a title (cm-201)
    const hadWs = q > p;
    if (q < n && hadWs && (src.charCodeAt(q) === 34 || src.charCodeAt(q) === 39 || src.charCodeAt(q) === C_LP)) {
      const t = parseTitle(src, q);
      if (t) {
        // after the title only spaces/tabs may follow on its line
        let r = t.end;
        while (r < n && (src.charCodeAt(r) === C_SPACE || src.charCodeAt(r) === C_TAB)) r++;
        if (r < n && src.charCodeAt(r) !== C_LF) {
          // junk after the title: on the next line the definition still
          // ends after the destination (cm-210); on the same line it is
          // not a definition at all
          if (crossedNewline) titleEndPos = p;
          else return null;
        } else {
          title = t.title;
          titleEndPos = t.end;
        }
      } else if (crossedNewline) {
        // not a title on the next line: definition ends after destination
        titleEndPos = p;
      } else {
        // junk on the destination's own line: not a definition
        return null;
      }
    } else if (q < n && src.charCodeAt(q) !== C_LF) {
      // junk after the destination on the same line: not a definition
      // (cm-201: <bar>(baz) — the ( is not preceded by a space)
      if (!crossedNewline) return null;
      titleEndPos = p;
    } else {
      titleEndPos = p;
    }
  }
  const consumed = src.slice(0, titleEndPos).split('\n').length - 1;
  return { label, href, title, next: idx + consumed + 1 };
}

// Resolve backslash escapes and entities in a string (used for link
// destinations, titles, and image alt text). Returns the processed string.
function resolveEscapesEntities(s) {
  if (s.indexOf('\\') === -1 && s.indexOf('&') === -1) return s;
  let out = '';
  let start = 0;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === C_BSLASH && i + 1 < n && isAsciiPunctCh(s.charCodeAt(i + 1))) {
      out += s.slice(start, i) + s[i + 1];
      i += 2; start = i;
    } else if (c === C_AMP) {
      const d = decodeNumericEntity(s, i);
      if (d) {
        out += s.slice(start, i) + d[0];
        i = d[1]; start = i;
      } else {
        const e = namedEntityEnd(s, i);
        if (e !== -1) {
          out += s.slice(start, e);
          i = e; start = i;
        } else {
          i++;
        }
      }
    } else {
      i++;
    }
  }
  return out + s.slice(start);
}

// Find the index of the matching ']' for the '[' at s[i], scanning inline
// content (nested brackets and code spans are honoured). Returns -1.
function findLinkEnd(s, i) {
  const n = s.length;
  let depth = 1;
  let j = i + 1;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === C_BSLASH && j + 1 < n) { j += 2; continue; }
    if (c === C_BTICK) {
      let k = j;
      while (k < n && s.charCodeAt(k) === C_BTICK) k++;
      const run = k - j;
      // marked's label regex allows a code-span pair whose runs differ
      // in length (`+(?!`)[^`]*?`+(?!`)) — the closer is the NEXT
      // backtick run of ANY length. If there is no later backtick run,
      // the label cannot match and the link FAILS — unless the run is
      // 2+ backticks immediately before `]` (``+(?=])).
      if (run >= 2 && k < n && s.charCodeAt(k) === C_RBR) { j = k; continue; }
      // The closer run must appear BEFORE the label's closing `]`
      // (doc-23: a backtick after the `]` is not a closer). Scan for
      // it tracking bracket depth; a `]` that would close the label
      // first means the backtick has no closer and the link fails.
      let m = k;
      let found = -1;
      let d = depth;
      while (m < n) {
        const mc = s.charCodeAt(m);
        if (mc === C_BSLASH && m + 1 < n) { m += 2; continue; }
        if (mc === C_BTICK) {
          let q = m;
          while (q < n && s.charCodeAt(q) === C_BTICK) q++;
          found = q;
          break;
        }
        if (mc === C_LBR) d++;
        else if (mc === C_RBR) { d--; if (d === 0) return -1; }
        m++;
      }
      if (found === -1) return -1;
      j = found;
      continue;
    }
    if (c === C_LBR) depth++;
    else if (c === C_RBR) {
      depth--;
      if (depth === 0) return j;
    } else if (c === C_LT) {
      // skip an HTML tag or autolink so a ] inside it does not close
      // the label
      const te = htmlTagEnd(s, j);
      if (te !== -1) { j = te; continue; }
      const al = tryAutolink(s, j);
      if (al) { j = al.end; continue; }
    }
    j++;
  }
  return -1;
}

// Try to parse a link or image starting at s[i] === '[' (or '![').
// Returns {node, end} or null. `isImage` when the '[' is preceded by '!'.
function tryLink(s, i, refs, isImage) {
  const n = s.length;
  const close = findLinkEnd(s, i);
  if (close === -1) return null;
  const labelText = s.slice(i + 1, close);
  let j = close + 1;
  let href = null, title = null;
  if (j < n && s[j] === '(') {
    const p = parseLinkParens(s, j);
    if (p) {
      href = p.href; title = p.title; j = p.end;
    } else {
      // inline link failed: fall back to a shortcut reference link,
      // leaving the "(...)" as literal text
      if (hasUnescapedBracket(labelText)) return null;
      const ref = refs.get(normalizeLabel(labelText));
      if (!ref) return null;
      href = ref.href; title = ref.title;
    }
  } else if (j < n && s[j] === '[') {
    // [text][label] or [text][]
    const lc = s.indexOf(']', j + 1);
    if (lc === -1) return null;
    const lab = lc === j + 1 ? labelText : s.slice(j + 1, lc);
    if (hasUnescapedBracket(lab)) return null;
    const ref = refs.get(normalizeLabel(lab));
    if (!ref) return null;
    href = ref.href; title = ref.title; j = lc + 1;
  } else {
    // shortcut reference [text]
    if (hasUnescapedBracket(labelText)) return null;
    const ref = refs.get(normalizeLabel(labelText));
    if (!ref) return null;
    href = ref.href; title = ref.title;
  }
  href = encodeHref(resolveEscapesEntities(href));
  if (title !== null && title !== undefined) title = resolveEscapesEntities(title);
  if (isImage) {
    const alt = renderAltText(labelText);
    return { node: { t: 4, src: href, title, alt, p: i - 1 }, end: j };
  }
  const children = tokenizeInline(labelText, refs, true);
  processEmphasis(children);
  // links cannot nest: if the label itself contains a link, the outer
  // link is not formed
  if (containsLink(children)) return null;
  return { node: { t: 3, href, title, children, p: i }, end: j };
}

// Does this node list contain a link node (t:3) at any depth?
function containsLink(nodes) {
  // a link's text may contain an autolink (<...> or bare URL) but not
  // another real link: autolinks (auto:true) do not invalidate the outer
  // link (marked)
  for (const nd of nodes) {
    if (nd.t === 3 && !nd.auto) return true;
    if (nd.children && containsLink(nd.children)) return true;
  }
  return false;
}

// Render image alt text: the label parsed as inline, then all tags stripped.
// Entities and escapes are resolved; emphasis/links contribute their text.
function renderAltText(labelText) {
  const nodes = tokenizeInline(labelText, new Map());
  let out = '';
  const walk = (ns) => {
    for (const nd of ns) {
      if (nd.t === 0) out += nd.s;
      else if (nd.t === 2) out += nd.s;
      else if (nd.t === 3 || nd.t === 7 || nd.t === 8 || nd.t === 9) walk(nd.children);
      else if (nd.t === 4) out += nd.alt;
      else if (nd.t === 5) { /* raw html contributes nothing */ }
      else if (nd.t === 6) out += '\n';
    }
  };
  walk(nodes);
  return escapeAttr(resolveEscapesEntities(out));
}

// Is s[i] the start of a valid inline HTML tag / comment / PI / CDATA?
// Returns the end index (exclusive) or -1.
function htmlTagEnd(s, i) {
  const n = s.length;
  if (s[i] !== '<') return -1;
  let j = i + 1;
  if (j >= n) return -1;
  // comment: <!--> and <!---> are self-contained tags (abrupt close)
  if (s.startsWith('<!--', i)) {
    if (s.startsWith('<!-->', i)) return i + 5;
    if (s.startsWith('<!--->', i)) return i + 6;
    const e = s.indexOf('-->', i + 4);
    if (e === -1) return -1;
    return e + 3;
  }
  // processing instruction
  if (s.startsWith('<?', i)) {
    const e = s.indexOf('?>', i + 2);
    if (e === -1) return -1;
    return e + 2;
  }
  // declaration <!A ...> and CDATA
  if (s.startsWith('<!', i)) {
    if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9);
      if (e === -1) return -1;
      return e + 3;
    }
    const c = j + 1 < n ? s.charCodeAt(j + 1) : 0;
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      const e = s.indexOf('>', i + 2);
      if (e === -1) return -1;
      return e + 1;
    }
    return -1;
  }
  // closing tag </name>
  let closing = false;
  if (s[j] === '/') { closing = true; j++; }
  if (j >= n) return -1;
  const c0 = s.charCodeAt(j);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return -1;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (isAlnumCh(c) || c === 45) j++;
    else break;
  }
  if (closing) {
    while (j < n && (s.charCodeAt(j) === C_SPACE || s.charCodeAt(j) === C_TAB)) j++;
    if (j < n && s[j] === '>') return j + 1;
    return -1;
  }
  // open tag: attributes (each must be preceded by whitespace)
  while (j < n) {
    const wsStart = j;
    while (j < n && (s.charCodeAt(j) === C_SPACE || s.charCodeAt(j) === C_TAB || s.charCodeAt(j) === C_LF)) j++;
    const skipped = j > wsStart;
    if (j >= n) return -1;
    if (s[j] === '>') return j + 1;
    if (s[j] === '/' && j + 1 < n && s[j + 1] === '>') return j + 2;
    if (!skipped) return -1;
    // attribute name
    const ac = s.charCodeAt(j);
    if (!((ac >= 65 && ac <= 90) || (ac >= 97 && ac <= 122) || ac === 95 || ac === 58)) return -1;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (isAlnumCh(c) || c === 95 || c === 58 || c === 45 || c === 46) j++;
      else break;
    }
    // optional whitespace then '=' then value; if no '=', the whitespace
    // still separates the next attribute
    const saveJ = j;
    while (j < n && (s.charCodeAt(j) === C_SPACE || s.charCodeAt(j) === C_TAB || s.charCodeAt(j) === C_LF)) j++;
    if (j < n && s[j] === '=') {
      j++;
      while (j < n && (s.charCodeAt(j) === C_SPACE || s.charCodeAt(j) === C_TAB || s.charCodeAt(j) === C_LF)) j++;
      if (j >= n) return -1;
      const q = s[j];
      if (q === '"' || q === "'") {
        const e = s.indexOf(q, j + 1);
        if (e === -1) return -1;
        j = e + 1;
      } else {
        // unquoted value: no space, ", ', =, <, >, `
        while (j < n) {
          const c = s.charCodeAt(j);
          if (c === C_SPACE || c === C_TAB || c === C_LF || c === C_QUOT ||
              c === C_SQ || c === 61 || c === C_LT || c === C_GT || c === C_BTICK) break;
          j++;
        }
      }
    } else {
      j = saveJ;
    }
  }
  return -1;
}

// Try an autolink starting at s[i] === '<'. Returns {node, end} or null.
// marked's rule: <scheme:...> (any chars but whitespace, controls, <, >)
// or an email address with the full local-part character set.
function tryAutolink(s, i) {
  const n = s.length;
  const close = s.indexOf('>', i + 1);
  if (close === -1) return null;
  const inner = s.slice(i + 1, close);
  if (inner.length === 0) return null;
  for (let k = 0; k < inner.length; k++) {
    const c = inner.charCodeAt(k);
    if (c <= 32 || c === C_LT) return null; // space, newline, control, <
  }
  // scheme: [a-zA-Z][a-zA-Z0-9+.-]{1,31}:
  let m = 0;
  {
    const c0 = inner.charCodeAt(0);
    if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) m = -1;
    else {
      let k = 1;
      while (k < inner.length) {
        const c = inner.charCodeAt(k);
        if (isAlnumCh(c) || c === 43 || c === 46 || c === 45) { k++; continue; }
        break;
      }
      if (k < 2 || k > 32 || k >= inner.length || inner.charCodeAt(k) !== C_COLON) m = -1;
      else m = k + 1;
    }
  }
  if (m !== -1) {
    return { node: { t: 3, href: encodeHref(inner), title: null, children: [{ t: 0, s: inner, p: i + 1 }], p: i, auto: true }, end: close + 1 };
  }
  // email: local@domain (full local set, labels 1-63 chars, >= 2 labels)
  if (isAutolinkEmail(inner)) {
    const href = 'mailto:' + inner;
    return { node: { t: 3, href: encodeHref(href), title: null, children: [{ t: 0, s: inner, p: i + 1 }], p: i, auto: true }, end: close + 1 };
  }
  return null;
}

// Is `inner` an email address for a <...> autolink? Local part:
// [A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+ ; domain: labels of 1-63 chars starting
// with an alphanumeric, at least two labels, not followed by - or _.
function isAutolinkEmail(inner) {
  const at = inner.indexOf('@');
  if (at <= 0) return false;
  for (let k = 0; k < at; k++) {
    const c = inner.charCodeAt(k);
    if (isAlnumCh(c) || c === 46 || c === 33 || c === 35 || c === 36 || c === 37 ||
        c === 38 || c === 39 || c === 42 || c === 43 || c === 47 || c === 61 ||
        c === 63 || c === 94 || c === 95 || c === 96 || c === 123 || c === 124 ||
        c === 125 || c === 126 || c === 45) continue;
    return false;
  }
  // domain: labels separated by dots; each label is 1-63 chars, starts
  // and ends with an alphanumeric, at least two labels, and the whole
  // string must be the email (nothing may follow the last label).
  let j = at + 1;
  let labels = 0;
  const n = inner.length;
  while (j < n) {
    const c0 = inner.charCodeAt(j);
    if (!isAlnumCh(c0)) return false;
    let len = 0;
    let lastAlnum = -1;
    while (j < n) {
      const c = inner.charCodeAt(j);
      if (isAlnumCh(c)) { len++; lastAlnum = j; j++; continue; }
      if (c === 45) { len++; j++; continue; }
      break;
    }
    if (len < 1 || len > 63) return false;
    if (lastAlnum !== j - 1) return false; // label must end alphanumeric
    labels++;
    if (j < n && inner.charCodeAt(j) === 46) { j++; if (j >= n) return false; continue; }
    break;
  }
  if (labels < 2) return false;
  if (j !== n) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Extended autolinks (GFM) and email autolinks
// ---------------------------------------------------------------------------
//
// marked's url rule, in order:
//   1. mailto:<email> | xmpp:<email>(/<segment>)?   (lowercase schemes only,
//      preceded by a non-alphanumeric or the start of the string)
//   2. http:// | https:// | ftp://  (case-insensitive, any preceding char)
//      + host + rest, then the backpedal trim
//   3. www.  (preceded by start, whitespace, *, _, ~ or ()
//      + host + rest, then the backpedal trim
//   4. a bare email address (found where the scanner meets '@')
// An email is [A-Za-z0-9._+-]+ @ <domain>, the domain being labels of
// [a-zA-Z0-9-_] joined by dots (at least two labels, every label after the
// first ending in an alphanumeric), not followed by a word char or '-'.

// Scan an email domain starting at s[j] (just after '@'). Returns the end
// index (exclusive) or -1. The first label is [a-zA-Z0-9-_]+; later labels
// are [a-zA-Z0-9-_]*[a-zA-Z0-9] (must end alphanumeric).
function emailDomainEnd(s, j, allowTrail) {
  const n = s.length;
  let k = j;
  while (k < n) {
    const c = s.charCodeAt(k);
    if (isAlnumCh(c) || c === 45 || c === 95) k++;
    else break;
  }
  if (k === j) return -1;
  let labels = 1;
  while (k < n && s.charCodeAt(k) === C_DOT) {
    let m = k + 1;
    let lastAlnum = -1;
    while (m < n) {
      const c = s.charCodeAt(m);
      if (isAlnumCh(c)) { lastAlnum = m; m++; }
      else if (c === 45 || c === 95) m++;
      else break;
    }
    if (m === k + 1) break; // no label after the dot: domain ends here
    if (lastAlnum !== m - 1) {
      // label ends with _ or - (not alnum). When allowTrail is set,
      // a trailing run of ONLY '_' is an emphasis delimiter, not part
      // of the domain: end the label at the last alnum instead of
      // failing (marked tokenizes the em content separately, so the
      // closer _ is never part of the email there).
      if (allowTrail && lastAlnum >= k + 1) {
        let q = lastAlnum + 1;
        let allUnder = true;
        while (q < m) { if (s.charCodeAt(q) !== 95) { allUnder = false; break; } q++; }
        if (allUnder) { labels++; k = lastAlnum + 1; continue; }
      }
      return -1; // label must end alphanumeric
    }
    labels++;
    k = m;
  }
  if (labels < 2) return -1;
  // (?![\w-]): the next char must not be a word char or '-'. A trailing
  // '_' is allowed only when it's an emphasis delimiter (allowTrail).
  if (k < n) {
    const c = s.charCodeAt(k);
    if (isAlnumCh(c) || c === 45) return -1;
    if (c === 95 && !allowTrail) return -1;
  }
  return k;
}

// Match an email starting at s[start] (the local part). Returns the end
// index (exclusive) or -1. Local part: [A-Za-z0-9._+-]+ .
function matchEmail(s, start, allowTrail) {
  const n = s.length;
  let j = start;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (isAlnumCh(c) || c === C_DOT || c === 43 || c === 95 || c === 45) j++;
    else break;
  }
  if (j === start) return -1;
  if (j >= n || s.charCodeAt(j) !== C_AT) return -1;
  return emailDomainEnd(s, j + 1, allowTrail);
}

// Scan the local part of an email backwards from the '@' at s[atPos].
// Returns the start index of the local part, or -1 when there is none.
function emailLocalBack(s, atPos) {
  let ls = atPos;
  while (ls > 0) {
    const c = s.charCodeAt(ls - 1);
    if (isAlnumCh(c) || c === C_DOT || c === 43 || c === 95 || c === 45) {
      // a char preceded by an odd run of backslashes is the result of a
      // backslash-escape token, not a local-part char: the local part
      // ends here (cm-606: the + in \+@ is escaped, so there is no
      // email at that @)
      let bs = 0;
      let q = ls - 2;
      while (q >= 0 && s.charCodeAt(q) === C_BSLASH) { bs++; q--; }
      if (bs % 2 === 1) break;
      ls--;
    } else break;
  }
  return ls === atPos ? -1 : ls;
}

// Is the char a "plain" backpedal char — anything but the trailing
// punctuation set ? ! . , : ; * _ ' " ~ and the paren/ampersand specials?
function isBackpedalPlain(c) {
  return !(c === 63 || c === 33 || c === 46 || c === 44 || c === 58 ||
    c === 59 || c === 42 || c === 95 || c === 39 || c === 34 ||
    c === 126 || c === 40 || c === 41 || c === 38);
}
// Is the char one of the backpedal trailing-punctuation chars
// (including ')' — a run of these at the very end is dropped)?
function isBackpedalPunct(c) {
  return c === 63 || c === 33 || c === 46 || c === 44 || c === 58 ||
    c === 59 || c === 42 || c === 95 || c === 39 || c === 34 ||
    c === 126 || c === 41;
}

// The backpedal trim, as marked applies it (repeated until stable — which
// is the same as this single left-to-right pass): scan the candidate URL
// s[start..end); plain chars and balanced (...) pairs are kept; an & that
// starts an &name; entity at the very end stops the match; a run of
// trailing punctuation that reaches the end is dropped entirely.
function backpedalEnd(s, start, end) {
  let k = start;
  while (k < end) {
    const c = s.charCodeAt(k);
    if (isBackpedalPlain(c)) { k++; continue; }
    if (c === 40) { // '(' — a pair (...) is kept whole
      let m = k + 1;
      while (m < end && s.charCodeAt(m) !== 41) m++;
      if (m >= end) break; // no closing paren: stop before the '('
      k = m + 1;
      continue;
    }
    if (c === 38) { // '&'
      // an &name; entity at the very end stops the match
      let m = k + 1;
      while (m < end && isAlnumCh(s.charCodeAt(m))) m++;
      if (m > k + 1 && m === end - 1 && s.charCodeAt(m) === 59) break;
      k++;
      continue;
    }
    // trailing punctuation run (including ')'): it is kept only when
    // followed by more characters
    let m = k;
    while (m < end && isBackpedalPunct(s.charCodeAt(m))) m++;
    if (m >= end) break; // run reaches the end: drop it
    k = m;
  }
  return k;
}

// Match http:// https:// ftp:// (case-insensitive) at s[i]. Returns the
// length of the scheme prefix (including ://) or 0.
function matchHttpPrefix(s, i) {
  const n = s.length;
  const c0 = s.charCodeAt(i) | 32;
  if (c0 === 104) { // h — http / https
    if (i + 4 >= n) return 0;
    if ((s.charCodeAt(i + 1) | 32) !== 116 || (s.charCodeAt(i + 2) | 32) !== 116 ||
        (s.charCodeAt(i + 3) | 32) !== 112) return 0;
    let j = i + 4;
    if (j < n && (s.charCodeAt(j) | 32) === 115) j++; // optional 's'
    if (j + 2 < n && s.charCodeAt(j) === 58 && s.charCodeAt(j + 1) === 47 && s.charCodeAt(j + 2) === 47) return j + 3 - i;
    return 0;
  }
  if (c0 === 102) { // f — ftp
    if (i + 3 >= n) return 0;
    if ((s.charCodeAt(i + 1) | 32) !== 116 || (s.charCodeAt(i + 2) | 32) !== 112) return 0;
    if (i + 5 < n && s.charCodeAt(i + 3) === 58 && s.charCodeAt(i + 4) === 47 && s.charCodeAt(i + 5) === 47) return 6;
    return 0;
  }
  return 0;
}

// Is s[i] the start of an extended autolink (www. / http(s):// / ftp:// /
// mailto: / xmpp:)? If so, returns {node, end}. Else null.
function tryExtendedAutolink(s, i, allowTrail) {
  const n = s.length;
  // mailto: / xmpp: — lowercase only, preceded by a non-alphanumeric
  // (or the start of the string)
  if (i === 0 || !isAlnumCh(s.charCodeAt(i - 1))) {
    if (s.startsWith('mailto:', i)) {
      const e = matchEmail(s, i + 7, allowTrail);
      if (e !== -1) {
        const url = s.slice(i, e);
        return { node: { t: 3, href: encodeHref(url), title: null, children: [{ t: 0, s: url, p: i }], p: i }, end: e };
      }
    } else if (s.startsWith('xmpp:', i)) {
      const e = matchEmail(s, i + 5, allowTrail);
      if (e !== -1) {
        let end = e;
        // optional single path segment /[A-Za-z0-9@.]+
        if (end < n && s.charCodeAt(end) === C_SLASH) {
          let k = end + 1;
          while (k < n) {
            const c = s.charCodeAt(k);
            if (isAlnumCh(c) || c === C_DOT || c === C_AT) k++;
            else break;
          }
          if (k > end + 1) end = k;
        }
        const url = s.slice(i, end);
        return { node: { t: 3, href: encodeHref(url), title: null, children: [{ t: 0, s: url, p: i }], p: i }, end };
      }
    }
  }
  // http:// https:// ftp:// — any preceding char
  let prefix = matchHttpPrefix(s, i);
  let hrefPrefix = '';
  if (prefix > 0) {
    const hostStart = i + prefix;
    if (hostStart >= n) return null;
    const hc = s.charCodeAt(hostStart);
    if (!isAlnumCh(hc) && hc !== 45) return null; // host needs a label char
    let end = hostStart;
    while (end < n) {
      const c = s.charCodeAt(end);
      if (isSpaceCh(c) || c === C_LT) break;
      end++;
    }
    end = backpedalEnd(s, i, end);
    if (end <= hostStart) return null;
    const url = s.slice(i, end);
    return { node: { t: 3, href: encodeHref(url), title: null, children: [{ t: 0, s: url, p: i }], p: i }, end };
  }
  // www. — preceded by start, whitespace, *, _, ~ or (
  if (s.startsWith('www.', i)) {
    if (i > 0) {
      const p = s.charCodeAt(i - 1);
      if (!(p === C_SPACE || p === C_TAB || p === C_LF || p === C_CR || p === 12 ||
          p === C_STAR || p === C_UNDER || p === C_TILDE || p === C_LP)) return null;
    }
    const hostStart = i + 4;
    if (hostStart >= n) return null;
    const hc = s.charCodeAt(hostStart);
    if (!isAlnumCh(hc) && hc !== 45) return null;
    let end = hostStart;
    while (end < n) {
      const c = s.charCodeAt(end);
      if (isSpaceCh(c) || c === C_LT) break;
      end++;
    }
    end = backpedalEnd(s, i, end);
    if (end <= hostStart) return null;
    const url = s.slice(i, end);
    return { node: { t: 3, href: encodeHref('http://' + url), title: null, children: [{ t: 0, s: url, p: i }], p: i }, end };
  }
  return null;
}

// Try an email autolink where s[i] === '@'. The local part is scanned back
// over the raw string (it may reach past delimiter nodes already emitted —
// the caller rewinds the node list to localStart). Returns
// {node, end, localStart} or null.
function tryEmailAutolink(s, i, allowTrail) {
  const n = s.length;
  const ls = emailLocalBack(s, i);
  if (ls === -1) return null;
  const end = emailDomainEnd(s, i + 1, allowTrail);
  if (end === -1) return null;
  const email = s.slice(ls, end);
  return { node: { t: 3, href: encodeHref('mailto:' + email), title: null, children: [{ t: 0, s: email, p: ls }], p: ls }, end, localStart: ls };
}

// ---------------------------------------------------------------------------
// Strikethrough
// ---------------------------------------------------------------------------
//
// marked's del rule: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?
// (?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/ — an opening run of one or two tildes
// (three or more can never delimit), content whose first character is not
// a space or tilde and whose last character is not a space, a tilde, or an
// unescaped backslash, and a closing run of the SAME length, after which
// the next character is not a tilde.

// Is the character at s[q] escaped (preceded by an odd run of backslashes)?
function isEscapedAt(s, q) {
  let k = q - 1;
  let backslashes = 0;
  while (k >= 0 && s.charCodeAt(k) === C_BSLASH) { backslashes++; k--; }
  return (backslashes % 2) === 1;
}

// Try to match a strikethrough starting at the tilde run s[i..j)
// (j - i is 1 or 2). Returns {node, end} or null.
function tryStrikethrough(s, i, j, refs, noExt) {
  const n = s.length;
  const run = j - i;
  // the character after the opening run must not be a space
  if (j >= n || isSpaceCh(s.charCodeAt(j))) return null;
  // Scan for the closing run, tracking nesting depth (marked's del is
  // matched like emStrong: a ~~ run that can open increments the depth,
  // a ~~ run that can close decrements it; the outer closer is where
  // the depth returns to 0). This yields nested <del> for
  // `~~a ~~b~~ c~~` instead of matching the first valid closer.
  let depth = 1;
  let k = j;
  while (k < n) {
    const c = s.charCodeAt(k);
    if (c === C_BSLASH && k + 1 < n) { k += 2; continue; }
    if (c === C_TILDE) {
      let q = k;
      while (q < n && s.charCodeAt(q) === C_TILDE) q++;
      if (q - k === run) {
        const afterOk = q >= n || s.charCodeAt(q) !== C_TILDE;
        const beforeCh = k > 0 ? s.charCodeAt(k - 1) : C_SPACE;
        const afterCh = q < n ? s.charCodeAt(q) : C_SPACE;
        const canOpen = !isSpaceCh(afterCh) && afterCh !== C_TILDE;
        const canClose = !isSpaceCh(beforeCh) && beforeCh !== C_TILDE && afterOk;
        if (canClose) {
          depth--;
          if (depth === 0) {
            const content = s.slice(j, k);
            if (content.length > 0) {
              const first = content.charCodeAt(0);
              const last = content.charCodeAt(content.length - 1);
              // last char of the content: not a space. A trailing ~ is
              // fine when its run length differs from the opener's (the
              // run is content, not a closer); only a trailing run of
              // the SAME length as the opener is ambiguous.
              let lastOk = !isSpaceCh(first) && !isSpaceCh(last);
              if (lastOk && last === C_TILDE && !isEscapedAt(content, content.length - 1)) {
                let rl = 0;
                for (let qq = content.length - 1; qq >= 0 && content.charCodeAt(qq) === C_TILDE; qq--) rl++;
                if (rl === run) lastOk = false;
              }
              if (lastOk) {
                const children = tokenizeInline(content, refs, noExt);
                processEmphasis(children);
                return { node: { t: 9, children, p: i }, end: q };
              }
            }
            return null;
          }
        } else if (canOpen) {
          depth++;
        }
      }
      k = q;
      continue;
    }
    k++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inline tokenizer + emphasis + rendering
// ---------------------------------------------------------------------------

// Compute canOpen/canClose for a delimiter run at s[start..end) of char ch.
// A boundary counts as whitespace (CommonMark reference behaviour).
function flanking(s, start, end) {
  const n = s.length;
  const before = start > 0 ? s.charCodeAt(start - 1) : -1;
  const after = end < n ? s.charCodeAt(end) : -1;
  const beforeWs = before === -1 ? true : isUniWs(before);
  const afterWs = after === -1 ? true : isUniWs(after);
  const beforePunct = before !== -1 && isPunctCh(before);
  const afterPunct = after !== -1 && isPunctCh(after);
  const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
  const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
  return { leftFlanking, rightFlanking };
}

// Rewind the node list back to source position localStart (for an email
// autolink whose local part reaches into already-emitted nodes): pop every
// node that starts at or after localStart, and truncate a text node that
// straddles it. Delimiter runs can never straddle it (their characters are
// all in the email local set, so the scan passes through a whole run), and
// code/link/html/br nodes end before it by construction.
function rewindNodes(nodes, localStart) {
  while (nodes.length > 0) {
    const last = nodes[nodes.length - 1];
    if (last.p < localStart) {
      if (last.t === 0 && last.p + last.s.length > localStart) {
        last.s = last.s.slice(0, localStart - last.p);
      }
      break;
    }
    nodes.pop();
  }
}

// Tokenize inline text into nodes. refs: Map<label, {href, title}>.
// noExt disables the extended autolinks (bare URL / www / email /
// mailto / xmpp): inside a link's text a bare URL is plain text, not
// an autolink (marked), while a <...> autolink still applies.
function tokenizeInline(s, refs, noExt) {
  const nodes = [];
  const n = s.length;
  let i = 0;
  let textStart = 0;
  const flushText = (end) => {
    if (end > textStart) nodes.push({ t: 0, s: s.slice(textStart, end), p: textStart });
    textStart = end;
  };
  while (i < n) {
    const c = s.charCodeAt(i);
    // backslash
    if (c === C_BSLASH) {
      if (i + 1 < n) {
        const nc = s.charCodeAt(i + 1);
        if (nc === C_LF) {
          flushText(i);
          nodes.push({ t: 6, p: i });
          i += 2;
          while (i < n && (s.charCodeAt(i) === C_SPACE || s.charCodeAt(i) === C_TAB)) i++;
          textStart = i;
          continue;
        }
        if (isAsciiPunctCh(nc)) {
          flushText(i);
          nodes.push({ t: 0, s: s[i + 1], p: i });
          i += 2; textStart = i;
          continue;
        }
      }
      i++;
      continue;
    }
    // code span
    if (c === C_BTICK) {
      let j = i;
      while (j < n && s.charCodeAt(j) === C_BTICK) j++;
      const run = j - i;
      let k = j;
      let found = -1;
      while (k < n) {
        if (s.charCodeAt(k) === C_BTICK) {
          let q = k;
          while (q < n && s.charCodeAt(q) === C_BTICK) q++;
          if (q - k === run) { found = k; break; }
          k = q;
        } else k++;
      }
      if (found === -1) { i = j; continue; } // literal backticks
      let content = s.slice(j, found);
      content = content.replace(/\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      flushText(i);
      nodes.push({ t: 2, s: content, p: i });
      i = found + run; textStart = i;
      continue;
    }
    // strikethrough: a run of one or two tildes, matched directly
    if (c === C_TILDE) {
      let j = i;
      while (j < n && s.charCodeAt(j) === C_TILDE) j++;
      if (j - i <= 2) {
        const d = tryStrikethrough(s, i, j, refs, noExt);
        if (d) {
          flushText(i);
          nodes.push(d.node);
          i = d.end; textStart = i;
          continue;
        }
      }
      // literal tildes (a run of 3+, or no matching closer)
      i = j;
      continue;
    }
    // emphasis delimiters * _
    if (c === C_STAR || c === C_UNDER) {
      let j = i;
      while (j < n && s.charCodeAt(j) === c) j++;
      const ch = c === C_STAR ? '*' : '_';
      const fl = flanking(s, i, j);
      let canOpen, canClose;
      if (ch === '_') {
        canOpen = fl.leftFlanking && (!fl.rightFlanking || (i > 0 && isPunctCh(s.charCodeAt(i - 1))));
        canClose = fl.rightFlanking && (!fl.leftFlanking || (j < n && isPunctCh(s.charCodeAt(j))));
      } else {
        canOpen = fl.leftFlanking;
        canClose = fl.rightFlanking;
      }
      flushText(i);
      nodes.push({ t: 1, ch, len: j - i, open: canOpen, close: canClose, p: i });
      i = j; textStart = i;
      continue;
    }
    // image ![
    if (c === C_BANG && i + 1 < n && s.charCodeAt(i + 1) === C_LBR) {
      const r = tryLink(s, i + 1, refs, true);
      if (r) {
        flushText(i);
        nodes.push(r.node);
        i = r.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // link [
    if (c === C_LBR) {
      const r = tryLink(s, i, refs, false);
      if (r) {
        flushText(i);
        nodes.push(r.node);
        i = r.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // < autolink or html
    if (c === C_LT) {
      const a = tryAutolink(s, i);
      if (a) {
        flushText(i);
        nodes.push(a.node);
        i = a.end; textStart = i;
        continue;
      }
      const h = htmlTagEnd(s, i);
      if (h !== -1) {
        flushText(i);
        const tagText = s.slice(i, h);
        nodes.push({ t: 5, s: tagText, p: i });
        const ak = anchorTagKind(tagText);
        if (ak === 'open') inLink = true;
        else if (ak === 'close') inLink = false;
        i = h; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // entity
    if (c === C_AMP) {
      const d = decodeNumericEntity(s, i);
      if (d) {
        flushText(i);
        nodes.push({ t: 0, s: d[0], p: i });
        i = d[1]; textStart = i;
        continue;
      }
      const e = namedEntityEnd(s, i);
      if (e !== -1) {
        flushText(i);
        nodes.push({ t: 5, s: s.slice(i, e), p: i });
        i = e; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // extended autolink www. / http(s):// / ftp:// / mailto: / xmpp:
    // (disabled inside link text: a bare URL there is plain text;
    // also disabled while inside an unclosed <a> tag, marked's
    // document-persistent inLink state)
    if (!noExt && !inLink && ((c >= 97 && c <= 122) || (c >= 65 && c <= 90))) { // a letter
      // Is there an unmatched '_' opener before this point? If so, a
      // trailing '_' after an email domain is an emphasis delimiter,
      // not part of the domain (marked tokenizes em content
      // separately). Compute once per branch entry.
      let allowTrail = false;
      for (let q = 0; q < nodes.length; q++) {
        const nd = nodes[q];
        if (nd.t === 1 && nd.ch === '_' && nd.open) { allowTrail = true; break; }
      }
      const a = tryExtendedAutolink(s, i, allowTrail);
      if (a) {
        flushText(i);
        nodes.push(a.node);
        i = a.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // email autolink at @ (disabled inside link text; also disabled
    // while inside an unclosed <a> tag, marked's inLink state)
    if (!noExt && !inLink && c === C_AT) {
      let allowTrail = false;
      for (let q = 0; q < nodes.length; q++) {
        const nd = nodes[q];
        if (nd.t === 1 && nd.ch === '_' && nd.open) { allowTrail = true; break; }
      }
      const e = tryEmailAutolink(s, i, allowTrail);
      if (e) {
        if (e.localStart < textStart) rewindNodes(nodes, e.localStart);
        else flushText(e.localStart);
        nodes.push(e.node);
        i = e.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // newline: soft break, or hard break if 2+ trailing spaces
    if (c === C_LF) {
      let k = i - 1, spaces = 0;
      while (k >= textStart && s.charCodeAt(k) === C_SPACE) { spaces++; k--; }
      if (spaces >= 2) {
        flushText(i - spaces);
        nodes.push({ t: 6, p: i - spaces });
        i++;
        while (i < n && (s.charCodeAt(i) === C_SPACE || s.charCodeAt(i) === C_TAB)) i++;
        textStart = i;
        continue;
      }
      i++;
      flushText(i);
      textStart = i;
      continue;
    }
    i++;
  }
  flushText(n);
  return nodes;
}

// Process emphasis / strong on a node list (delimiters are * and _ only;
// strikethrough is matched directly during tokenization).
// Records matches on delimiter nodes, then wraps content into em/strong
// nodes. Returns the (possibly restructured) node list.
function processEmphasis(nodes) {
  const delims = [];
  for (const nd of nodes) if (nd.t === 1) delims.push(nd);
  if (delims.length === 0) return nodes;

  const openers = []; // stack of delim nodes that can open
  for (const d of delims) {
    if (d.close && d.len > 0) {
      while (d.len > 0) {
        let oi = openers.length - 1;
        let opener = null;
        while (oi >= 0) {
          const o = openers[oi];
          if (o.ch !== d.ch) { oi--; continue; }
          const oddMatch = (o.open && o.close) || (d.open && d.close);
          const bothMult3 = o.len % 3 === 0 && d.len % 3 === 0;
          // rule of 3: when the sum of the two runs is a multiple of 3 and
          // one of them can both open and close, the pair is skipped —
          // unless both runs are multiples of 3
          if (oddMatch && (o.len + d.len) % 3 === 0 && !bothMult3) {
            oi--; continue;
          }
          opener = o;
          break;
        }
        if (!opener) break;
        const use = (opener.len >= 2 && d.len >= 2) ? 2 : 1;
        const kind = use === 2 ? 8 : 7;
        const inner = wrapEmphasis(nodes, opener, d, kind, use);
        // delimiters now inside the new emphasis span can no longer pair
        // with a closer outside it: drop them from the opener stack
        if (inner) {
          for (const nd of inner) {
            if (nd.t === 1) {
              const ix = openers.indexOf(nd);
              if (ix !== -1) openers.splice(ix, 1);
            }
          }
        }
        opener.len -= use;
        d.len -= use;
        if (opener.len === 0) {
          const idx = openers.indexOf(opener);
          if (idx !== -1) openers.splice(idx, 1);
        }
      }
    }
    if (d.open && d.len > 0) {
      if (!openers.includes(d)) openers.push(d);
    }
  }
  return nodes;
}

// Wrap the nodes between opener and closer into an em/strong node.
// opener and closer are delimiter node objects currently in `nodes`.
// Returns the wrapped children (for opener-stack cleanup) or null.
function wrapEmphasis(nodes, opener, closer, kind, use) {
  const oi = nodes.indexOf(opener);
  const di = nodes.indexOf(closer);
  if (oi === -1 || di === -1 || di <= oi) return null;
  const children = nodes.slice(oi + 1, di);
  const emNode = { t: kind, children };
  const parts = [];
  if (opener.len - use > 0) parts.push(opener);
  parts.push(emNode);
  if (closer.len - use > 0) parts.push(closer);
  nodes.splice(oi, di - oi + 1, ...parts);
  return children;
}

// Render a node list to HTML.
function renderInline(nodes, out) {
  for (const nd of nodes) {
    switch (nd.t) {
      case 0: out.push(escapeText(nd.s)); break;
      case 1:
        // leftover delimiter: literal chars
        out.push(nd.ch.repeat(nd.len));
        break;
      case 2:
        out.push('<code>' + escapeText(nd.s) + '</code>');
        break;
      case 3: {
        let a = '<a href="' + escapeAttr(nd.href) + '"';
        if (nd.title !== null && nd.title !== undefined) a += ' title="' + escapeAttr(nd.title) + '"';
        a += '>';
        out.push(a);
        renderInline(nd.children, out);
        out.push('</a>');
        break;
      }
      case 4: {
        let im = '<img src="' + escapeAttr(nd.src) + '" alt="' + nd.alt + '"';
        if (nd.title !== null && nd.title !== undefined) im += ' title="' + escapeAttr(nd.title) + '"';
        im += '>';
        out.push(im);
        break;
      }
      case 5:
        out.push(nd.s);
        break;
      case 6:
        out.push('<br>');
        break;
      case 7:
        out.push('<em>');
        renderInline(nd.children, out);
        out.push('</em>');
        break;
      case 8:
        out.push('<strong>');
        renderInline(nd.children, out);
        out.push('</strong>');
        break;
      case 9:
        out.push('<del>');
        renderInline(nd.children, out);
        out.push('</del>');
        break;
    }
  }
}

// Parse inline text to HTML. refs: Map<label, {href, title}>.
function parseInline(text, refs) {
  if (text === '') return '';
  const nodes = tokenizeInline(text, refs);
  processEmphasis(nodes);
  const out = [];
  renderInline(nodes, out);
  return out.join('');
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

// Column width of the leading whitespace of a line (tab = next multiple of 4).
function indentCols(line) {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === C_SPACE) col++;
    else if (c === C_TAB) col += 4 - (col % 4);
    else break;
  }
  return col;
}

// Expand the leading tabs of `line` (which starts at absolute column
// startCol) into spaces, returning the line with its leading whitespace as
// plain spaces. Columns are preserved, so a tab that straddles a strip
// boundary leaves the right number of spaces behind.
function expandLeadingWs(line, startCol) {
  let col = startCol;
  let i = 0;
  let out = '';
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === C_SPACE) { out += ' '; col++; i++; }
    else if (c === C_TAB) { const nx = col + (4 - (col % 4)); out += ' '.repeat(nx - col); col = nx; i++; }
    else break;
  }
  return out + line.slice(i);
}

// Remove up to n columns of leading indentation. Leading tabs are expanded
// to spaces first, so the remainder is exact.
// Remove exactly n columns of leading indentation. A tab counts as
// expanding to the next multiple of 4; a tab that straddles the
// boundary contributes spaces for the part beyond n, and a tab that
// starts at or after column n is preserved as-is (CommonMark: an
// indented code line `    \tfoo` keeps its tab, doc-02).
function stripColumns(line, n) {
  if (n <= 0) return line;
  let col = 0, i = 0, out = '';
  while (i < line.length && col < n) {
    const c = line.charCodeAt(i);
    if (c === C_SPACE) { col++; i++; }
    else if (c === C_TAB) {
      const nx = col + (4 - (col % 4));
      if (nx <= n) { col = nx; i++; }
      else { out += ' '.repeat(nx - n); col = n; i++; }
    } else break;
  }
  return out + line.slice(i);
}

// Strip n columns after expanding all leading tabs to spaces (marked's
// list-item text has tabs expanded before the content indent is
// stripped, cm-005: `\t\tbar` in a list item becomes `  bar` of code).
function stripColumnsExpanded(line, n) {
  return expandLeadingWs(line, 0).slice(n);
}

// Remove n columns from the start of `str` (which starts at absolute column
// startCol), expanding leading tabs to spaces so the remainder stays
// correctly aligned. Used for container prefixes (blockquote / list), whose
// stripped lines are re-parsed and whose columns must stay exact.
function stripLeadingCols(str, startCol, n) {
  let cc = startCol, j = 0;
  while (j < str.length) {
    const ch = str.charCodeAt(j);
    if (ch === C_SPACE) { cc++; j++; }
    else if (ch === C_TAB) { cc += 4 - (cc % 4); j++; }
    else break;
  }
  const target = startCol + n;
  if (cc <= target) return str.slice(j);
  return ' '.repeat(cc - target) + str.slice(j);
}

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== C_SPACE && c !== C_TAB) return false;
  }
  return true;
}

// A line is a thematic break: 3+ of -, _, * (same char), spaces allowed.
function isThematicBreak(line) {
  const ind = indentCols(line);
  if (ind > 3) return false;
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  if (i >= line.length) return false;
  const ch = line.charCodeAt(i);
  if (ch !== C_DASH && ch !== 95 && ch !== C_STAR) return false;
  let count = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === ch) count++;
    else if (c === C_SPACE || c === C_TAB) { /* skip */ }
    else return false;
    i++;
  }
  return count >= 3;
}

// ATX heading: returns {level, text} or null.
function atxHeading(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  let level = 0;
  while (i < line.length && line.charCodeAt(i) === C_HASH) { level++; i++; }
  if (level === 0 || level > 6) return null;
  if (i < line.length) {
    const c = line.charCodeAt(i);
    if (c !== C_SPACE && c !== C_TAB) return null;
  }
  let text = line.slice(i);
  let end = text.length;
  while (end > 0 && (text.charCodeAt(end - 1) === C_SPACE || text.charCodeAt(end - 1) === C_TAB)) end--;
  text = text.slice(0, end);
  // closing sequence: spaces + #'s at end
  let j = text.length;
  while (j > 0 && text.charCodeAt(j - 1) === C_HASH) j--;
  if (j < text.length && j > 0 && (text.charCodeAt(j - 1) === C_SPACE || text.charCodeAt(j - 1) === C_TAB)) {
    text = text.slice(0, j);
    end = text.length;
    while (end > 0 && (text.charCodeAt(end - 1) === C_SPACE || text.charCodeAt(end - 1) === C_TAB)) end--;
    text = text.slice(0, end);
  }
  let st = 0;
  while (st < text.length && (text.charCodeAt(st) === C_SPACE || text.charCodeAt(st) === C_TAB)) st++;
  return { level, text: text.slice(st) };
}

// Setext underline: returns 1 for ===, 2 for ---, else 0.
function setextLevel(line) {
  const ind = indentCols(line);
  if (ind > 3) return 0;
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  if (i >= line.length) return 0;
  const ch = line.charCodeAt(i);
  if (ch !== 61 && ch !== C_DASH) return 0; // = or -
  let count = 0;
  while (i < line.length && line.charCodeAt(i) === ch) { count++; i++; }
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  if (i < line.length) return 0;
  if (count === 0) return 0;
  return ch === 61 ? 1 : 2;
}

// Fence start: returns {char, len, info, indent} or null.
function fenceStart(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  if (i >= line.length) return null;
  const ch = line.charCodeAt(i);
  if (ch !== C_BTICK && ch !== C_TILDE) return null;
  let j = i;
  while (j < line.length && line.charCodeAt(j) === ch) j++;
  const len = j - i;
  if (len < 3) return null;
  const info = line.slice(j);
  // for backtick fences, info must not contain a backtick
  if (ch === C_BTICK && info.indexOf('`') !== -1) return null;
  return { char: ch, len, info: info.trim(), indent: ind };
}

// Fence end line: same char, at least len, only spaces after.
function isFenceEnd(line, fence) {
  const ind = indentCols(line);
  if (ind > 3) return false;
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  let j = i;
  while (j < line.length && line.charCodeAt(j) === fence.char) j++;
  if (j - i < fence.len) return false;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if (c !== C_SPACE && c !== C_TAB) return false;
    j++;
  }
  return true;
}

// Block HTML tag names (marked's list, type 6).
const BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const BLOCK_TAG_RE = new RegExp('^<\\/?(?:' + BLOCK_TAGS + ')(\\s|\\/?>|\\/?$)', 'i');

// HTML block start type (1-7), or 0 if the line does not start one.
function htmlBlockType(line) {
  const ind = indentCols(line);
  if (ind > 3) return 0;
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  if (i >= line.length || line.charCodeAt(i) !== C_LT) return 0;
  const rest = line.slice(i);
  const lower = rest.toLowerCase();
  if (/^<(script|pre|style|textarea)(\s|>|$)/.test(lower)) return 1;
  if (lower.startsWith('<!--')) return 2;
  if (lower.startsWith('<?')) return 3;
  if (/^<![a-z]/i.test(rest)) return 4;
  if (lower.startsWith('<![cdata[')) return 5;
  if (BLOCK_TAG_RE.test(rest)) return 6;
  // type 7: a complete open or closing tag alone on the line
  {
    const t = rest.trim();
    if (t.startsWith('<')) {
      const e = htmlTagEnd(t, 0);
      if (e !== -1 && e === t.length) return 7;
    }
  }
  return 0;
}

// Does this line start an HTML block that interrupts an open paragraph?
// Marked's paragraph rule uses a NARROWER HTML alternative than the block
// rule: only K-tags (open or close), OPENING pre/script/style/textarea,
// comments, processing instructions, declarations and CDATA. A closing
// </pre>/</script>/</style>/</textarea> and a lone non-block tag like
// <span> do NOT interrupt a paragraph (they are paragraph text).
function paragraphHtmlInterrupt(line) {
  const ind = indentCols(line);
  if (ind > 3) return false;
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  if (i >= line.length || line.charCodeAt(i) !== C_LT) return false;
  const rest = line.slice(i);
  const lower = rest.toLowerCase();
  // opening pre/script/style/textarea only
  if (/^<(script|pre|style|textarea)(\s|>|$)/.test(lower)) return true;
  if (lower.startsWith('<!--')) return true;
  if (lower.startsWith('<?')) return true;
  if (/^<![a-z]/i.test(rest)) return true;
  if (lower.startsWith('<![cdata[')) return true;
  // K-tag open or close
  if (BLOCK_TAG_RE.test(rest)) return true;
  return false;
}

// End condition for an HTML block of the given type: returns true when the
// line ends the block (the line itself is included).
function htmlBlockEnds(line, type) {
  if (type === 1) return false; // caller checks the closing tag
  if (type === 2) return line.indexOf('-->') !== -1;
  if (type === 3) return line.indexOf('?>') !== -1;
  if (type === 4) return line.indexOf('>') !== -1;
  if (type === 5) return line.indexOf(']]>') !== -1;
  return false; // 6, 7 end only at a blank line
}

// List marker: returns {ordered, start, delim, markerLen, indent} or null.
function listMarker(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  if (i >= line.length) return null;
  const c = line.charCodeAt(i);
  if (c === C_DASH || c === 43 || c === C_STAR) {
    // bullet: must be followed by space/tab/EOL
    if (i + 1 >= line.length) return { ordered: false, start: 0, delim: String.fromCharCode(c), markerLen: 1, indent: ind };
    const nc = line.charCodeAt(i + 1);
    if (nc === C_SPACE || nc === C_TAB) return { ordered: false, start: 0, delim: String.fromCharCode(c), markerLen: 1, indent: ind };
    return null;
  }
  if (isDigitCh(c)) {
    let j = i;
    while (j < line.length && isDigitCh(line.charCodeAt(j))) j++;
    const numStr = line.slice(i, j);
    if (numStr.length > 9) return null;
    if (j < line.length && (line.charCodeAt(j) === C_DOT || line.charCodeAt(j) === C_RP)) {
      const delim = String.fromCharCode(line.charCodeAt(j));
      if (j + 1 >= line.length) return { ordered: true, start: parseInt(numStr, 10), delim, markerLen: j - i + 1, indent: ind };
      const nc = line.charCodeAt(j + 1);
      if (nc === C_SPACE || nc === C_TAB) return { ordered: true, start: parseInt(numStr, 10), delim, markerLen: j - i + 1, indent: ind };
    }
    return null;
  }
  return null;
}

// Table delimiter row: returns alignments array ('l','r','c',null) or null.
function tableDelimiter(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  if (s.length === 0) return null;
  const cells = s.split('|');
  const aligns = [];
  for (let cell of cells) {
    cell = cell.trim();
    if (!/^:?-+:?$/.test(cell)) return null;
    if (cell.startsWith(':') && cell.endsWith(':')) aligns.push('c');
    else if (cell.startsWith(':')) aligns.push('l');
    else if (cell.endsWith(':')) aligns.push('r');
    else aligns.push(null);
  }
  return aligns;
}

// Split a table row line into cells, exactly like marked's `de`:
// every unescaped | becomes a separator (even one inside a code span),
// an escaped \| stays literal. When headerLen is given, the row is
// truncated or padded with empty cells to that width.
function splitTableRow(line, headerLen) {
  const s = line.trim();
  // mark unescaped pipes: | preceded by an even number of backslashes
  // becomes " |" so the split on " |" sees only real separators
  let marked = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '|') {
      let bs = 0, k = i - 1;
      while (k >= 0 && s[k] === '\\') { bs++; k--; }
      if (bs % 2 === 0) { marked += s.slice(start, i) + ' |'; start = i + 1; }
    }
  }
  marked += s.slice(start);
  const parts = marked.split(' |');
  if (parts.length > 0 && parts[0].trim() === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();
  if (headerLen !== undefined && headerLen !== null) {
    if (parts.length > headerLen) parts.length = headerLen;
    else while (parts.length < headerLen) parts.push('');
  }
  return parts.map(x => x.trim().replace(/\\\|/g, '|'));
}

// Is this line a table delimiter row that can actually start a table?
// It must match the delimiter pattern AND contain a ':' or '|' — marked's
// table tokenizer rejects a delimiter with neither, so a bare '---' is a
// setext underline or thematic break, never a table delimiter.
function isRealTableDelimiter(line) {
  const d = tableDelimiter(line);
  if (!d) return null;
  if (line.indexOf(':') === -1 && line.indexOf('|') === -1) return null;
  return d;
}

// Does this line end a table's body (marked's table regex stops the body at
// a blank line or at a line starting a heading, thematic break, blockquote,
// indented code, fence, list, or HTML block)? Only the first four columns
// of indentation count for the lookahead.
function tableBodyEnds(line) {
  // marked's table body regex ends the body at a line of only SPACES
  // (`(?! *\n)`); a TAB-only line is a table row of empty cells, NOT a
  // blank line (doc-02/doc-05: a `\t` line after table rows).
  if (line.length === 0) return true;
  let spacesOnly = true;
  for (let k = 0; k < line.length; k++) {
    if (line.charCodeAt(k) !== C_SPACE) { spacesOnly = false; break; }
  }
  if (spacesOnly) return true;
  if (isThematicBreak(line)) return true;
  if (atxHeading(line)) return true;
  if (fenceStart(line)) return true;
  // indented code ends the table, but only when the line has non-whitespace
  // content after the indent (a whitespace-only line with a tab is a row
  // of empty cells, not a code block)
  if (indentCols(line) >= 4) {
    let hasContent = false;
    for (let k = 0; k < line.length; k++) {
      const c = line.charCodeAt(k);
      if (c !== C_SPACE && c !== C_TAB) { hasContent = true; break; }
    }
    if (hasContent) return true;
  }
  const qp = stripQuotePrefix(line);
  if (qp.had) return true;
  if (paragraphHtmlInterrupt(line)) return true;
  // list: a bullet, or an ordered marker starting with 1, + space/tab
  const ind = indentCols(line);
  if (ind <= 3) {
    let i = 0;
    while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
    if (i < line.length) {
      const c = line.charCodeAt(i);
      if (c === C_DASH || c === 43 || c === C_STAR) {
        if (i + 1 >= line.length) return true;
        const nc = line.charCodeAt(i + 1);
        if (nc === C_SPACE || nc === C_TAB) return true;
      } else if (c === 49) { // '1'
        if (i + 1 < line.length && (line.charCodeAt(i + 1) === C_DOT || line.charCodeAt(i + 1) === C_RP)) {
          if (i + 2 >= line.length) return true;
          const nc = line.charCodeAt(i + 2);
          if (nc === C_SPACE || nc === C_TAB) return true;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Block parsing helpers
// ---------------------------------------------------------------------------

// Remove up to n leading spaces from a line (after expanding leading
// Strip up to n columns of indent from a line (spaces and tabs).
// Used ONLY for fenced-code indent compensation. A tab that straddles
// the boundary is dropped ENTIRELY (marked keeps no remainder spaces
// for fences — `   ```toml` + `\tindented` renders `indented`, not
// ` indented`); this differs from indented-code stripping, which
// keeps the remainder.
function stripUpTo(line, n) {
  if (n <= 0) return line;
  let col = 0, i = 0;
  while (i < line.length && col < n) {
    const c = line.charCodeAt(i);
    if (c === C_SPACE) { col++; i++; }
    else if (c === C_TAB) {
      const nx = col + (4 - (col % 4));
      col = nx; i++;
    } else break;
  }
  return line.slice(i);
}

// Strip one blockquote marker from a line. Returns {had, text} where text
// is the line after the '>' plus one following space (a tab after '>' counts
// as one space, the rest of its expansion stays as spaces).
function stripQuotePrefix(line) {
  const ind = indentCols(line);
  if (ind > 3) return { had: false, text: line };
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === C_SPACE || line.charCodeAt(i) === C_TAB)) i++;
  if (i >= line.length || line.charCodeAt(i) !== 62) return { had: false, text: line }; // '>'
  // the '>' is at column ind; the content starts after it
  const after = line.slice(i + 1);
  if (after.length === 0) return { had: true, text: '' };
  const c = after.charCodeAt(0);
  if (c === C_SPACE) {
    // one space consumed; the rest starts at column ind+2
    return { had: true, text: expandLeadingWs(after.slice(1), ind + 2) };
  }
  if (c === C_TAB) {
    // the tab expands from column ind+1 to the next multiple of 4;
    // one column of it is the space after '>', the rest stays as spaces
    const tabEnd = (ind + 1) + (4 - ((ind + 1) % 4));
    const remaining = tabEnd - (ind + 2);
    return { had: true, text: ' '.repeat(Math.max(0, remaining)) + expandLeadingWs(after.slice(1), tabEnd) };
  }
  return { had: true, text: after };
}

// The content of a list item's first line, after the marker and the
// following whitespace. Returns {text, contentIndent}: the text after the
// marker gap, and the column where the item's content starts. When the gap
// after the marker is 5+ spaces, the content indent is marker+1 and the
// extra spaces stay in the text (CommonMark rule).
// Expand every tab in a line to spaces (column-based, next multiple of
// 4). Marked expands tabs in a list item's text, including the tabs
// after the marker, so the whitespace width after the marker is measured
// on the expanded line.
function expandAllTabs(line) {
  if (line.indexOf('\t') === -1) return line;
  let col = 0, i = 0, out = '';
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === C_TAB) { const nx = col + (4 - (col % 4)); out += ' '.repeat(nx - col); col = nx; i++; }
    else { out += line[i]; col++; i++; }
  }
  return out;
}

function listItemFirstContent(line, lm) {
  // expand all tabs to spaces so columns are exact (marked's item text
  // has tabs expanded, including after the marker)
  const exp = expandAllTabs(line);
  // the marker is at column lm.indent in the expanded line
  let i = lm.indent + lm.markerLen;
  let spaces = 0;
  while (i < exp.length && exp.charCodeAt(i) === C_SPACE) { spaces++; i++; }
  const text = exp.slice(i);
  if (spaces >= 5) return { text: ' '.repeat(spaces - 1) + text, contentIndent: lm.indent + lm.markerLen + 1 };
  if (text === '') return { text: '', contentIndent: lm.indent + lm.markerLen + 1 };
  return { text, contentIndent: lm.indent + lm.markerLen + spaces };
}

// Is a paragraph open at the end of these (already container-stripped)
// lines? That is what decides whether a line without a container prefix is
// a lazy continuation: it is only absorbed while the innermost block is an
// open paragraph. Walk the lines tracking block state: a fence, HTML block,
// heading, thematic break, setext underline, table delimiter, or blank
// line closes it; an indented line is code (closing it) unless a paragraph
// is already open, in which case it continues it; a plain text line (or a
// list item whose content starts a paragraph) leaves it open.
function paragraphOpenAtEnd(lines) {
  if (lines.length === 0) return false;
  let inPara = false;
  let fence = null, htmlType = 0;
  for (let k = 0; k < lines.length; k++) {
    const ln = lines[k];
    if (fence) { if (isFenceEnd(ln, fence)) fence = null; continue; }
    if (htmlType > 0) {
      if (htmlType === 1) { if (/<\/(script|pre|style|textarea)\s*>/i.test(ln)) htmlType = 0; }
      else if (htmlBlockEnds(ln, htmlType)) htmlType = 0;
      else if (htmlType >= 6 && isBlank(ln)) htmlType = 0;
      continue;
    }
    if (isBlank(ln)) { inPara = false; continue; }
    const f = fenceStart(ln);
    if (f) { fence = f; inPara = false; continue; }
    const ht = htmlBlockType(ln);
    if (ht > 0) { htmlType = ht; inPara = false; continue; }
    if (atxHeading(ln) || isThematicBreak(ln) || setextLevel(ln) > 0) { inPara = false; continue; }
    if (tableDelimiter(ln)) { inPara = false; continue; }
    const lm = listMarker(ln);
    if (lm) {
      const fc = listItemFirstContent(ln, lm);
      if (fc.text.trim() === '') { inPara = false; continue; }
      if (atxHeading(fc.text) || fenceStart(fc.text) || isThematicBreak(fc.text) || htmlBlockType(fc.text) > 0) inPara = false;
      else inPara = true;
      continue;
    }
    const qp = stripQuotePrefix(ln);
    if (qp.had) {
      const c = qp.text;
      if (isBlank(c)) { inPara = false; continue; }
      if (atxHeading(c) || fenceStart(c) || isThematicBreak(c) || htmlBlockType(c) > 0 || setextLevel(c) > 0) inPara = false;
      else inPara = true;
      continue;
    }
    // indented code (only when no paragraph is open)
    if (indentCols(ln) >= 4 && !inPara) { inPara = false; continue; }
    inPara = true;
  }
  return inPara;
}

// Is this line (no container prefix) a paragraph continuation — i.e. does
// it NOT start a new block that interrupts a paragraph? A list marker of
// any kind, an ATX heading, a thematic break, a fence, or an HTML block
// start all interrupt; a setext underline, a table-delimiter-looking line,
// an indented line, and plain text do not.
function isContinuationLine(line) {
  if (isBlank(line)) return false;
  if (atxHeading(line)) return false;
  if (isThematicBreak(line)) return false;
  if (fenceStart(line)) return false;
  if (paragraphHtmlInterrupt(line)) return false;
  if (listMarker(line)) return false;
  return true;
}

// Split collected container lines ({line, lazy}) into the chunks marked
// lexes separately: a new chunk starts at a lazy line that follows a
// non-lazy line. Paragraphs merge across chunks; tables and setext
// headings do not form across a chunk boundary.
function splitChunks(collected) {
  const chunks = [];
  let cur = [];
  let prevLazy = true;
  for (const c of collected) {
    if (c.lazy && !prevLazy) {
      // split here, UNLESS the current chunk ends with a nested
      // blockquote or list line: a lazy line after one of those belongs
      // to the nested block (marked re-lexes it with the remaining
      // lines), so it must stay in the same chunk
      const lastLine = cur.length > 0 ? cur[cur.length - 1].line : '';
      const nested = stripQuotePrefix(lastLine).had || listMarker(lastLine);
      if (!nested && cur.length > 0) {
        chunks.push(cur);
        cur = [];
      }
    }
    cur.push(c);
    prevLazy = c.lazy;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

// Render a list of blocks (from parseBlocks) to HTML.
function renderBlocks(blocks, refs) {
  let s = '';
  for (const b of blocks) {
    if (b.k === 'p') s += '<p>' + parseInline(b.text, refs) + '</p>\n';
    else if (b.k === 'c') s += '<pre><code>' + escapeText(b.text ? b.text + '\n' : '') + '</code></pre>\n';
    else s += b.s;
  }
  return s;
}

// Render one block (used by the tight-list path).
function renderBlock(b, refs) {
  if (b.k === 'p') return parseInline(b.text, refs);
  if (b.k === 'c') return '<pre><code>' + escapeText(b.text ? b.text + '\n' : '') + '</code></pre>\n';
  return b.s;
}

// Merge a chunk's blocks into the accumulated list: when the accumulated
// list ends with a paragraph and the chunk starts with one, the two
// paragraphs merge into a single paragraph (their texts joined with \n).
// When the chunk starts with an indented code block, it merges into the
// preceding paragraph instead (marked lexes the indented line as code
// and merges it into the open paragraph, indent stripped).
function mergeChunkBlocks(acc, chunkBlocks) {
  if (acc.length > 0 && chunkBlocks.length > 0 && acc[acc.length - 1].k === 'p') {
    if (chunkBlocks[0].k === 'p') {
      acc[acc.length - 1].text += '\n' + chunkBlocks[0].text;
      for (let i = 1; i < chunkBlocks.length; i++) acc.push(chunkBlocks[i]);
      return;
    }
    if (chunkBlocks[0].k === 'c') {
      acc[acc.length - 1].text += '\n' + chunkBlocks[0].text;
      for (let i = 1; i < chunkBlocks.length; i++) acc.push(chunkBlocks[i]);
      return;
    }
  }
  for (const b of chunkBlocks) acc.push(b);
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------
// Returns a list of blocks: {k:'p', text} for a paragraph, {k:'x', s}
// for any other block (already rendered HTML). `lazy` is a parallel array
// of booleans marking lines that were collected as lazy continuations — a
// setext underline on a lazy line never makes a heading (marked's
// blockquoteSetextReplace turns it into paragraph text instead).

function parseBlocks(lines, refs, lazy, topLevel, endsNl, inList) {
  // topLevel: true for the document input (which ends with a newline),
  // false for container inner text (blockquote/list item) which marked
  // trims of trailing newlines before lexing — an HTML block ending
  // there has no trailing newline. endsNl: whether the document source
  // ends with a newline (only meaningful at the top level); an HTML
  // block ending at EOF keeps its trailing newline only then. inList:
  // true when parsing a list item's content — inside a list item ANY
  // ordered list marker interrupts a paragraph (marked's list-item
  // lexing); elsewhere only a bullet or a list starting with 1 does.
  if (endsNl === undefined) endsNl = topLevel !== false;
  const out = [];
  let i = 0;
  // blankGap: true when a blank line separates two top-level blocks in
  // this parse (marked's "space" token); used by list parsing for the
  // loose/tight decision. Blank lines consumed inside a block (a nested
  // list, a fence, a quote) do not set it.
  let pendingGap = false;
  let hadBlankGap = false;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { if (out.length > 0) pendingGap = true; i++; continue; }
    if (pendingGap) { hadBlankGap = true; pendingGap = false; }
    const ind = indentCols(line);
    const isLazyLine = lazy ? !!lazy[i] : false;

    // ---- blockquote ----
    const qp = stripQuotePrefix(line);
    if (qp.had) {
      const collected = [{ line: qp.text, lazy: false }];
      let j = i + 1;
      while (j < lines.length) {
        const q2 = stripQuotePrefix(lines[j]);
        if (q2.had) { collected.push({ line: q2.text, lazy: false }); j++; }
        else if (!isBlank(lines[j]) && paragraphOpenAtEnd(collected.map(c => c.line)) && isContinuationLine(lines[j])) {
          // lazy continuation line (no '>' prefix)
          const cl = lines[j];
          collected.push({ line: cl, lazy: true });
          j++;
        } else break;
      }
      // lex the quote's lines chunk by chunk (see splitChunks)
      const chunks = splitChunks(collected);
      const allBlocks = [];
      for (const chunk of chunks) {
        const chunkLines = [];
        const chunkLazy = [];
        for (let ci = 0; ci < chunk.length; ci++) {
          let ln = chunk[ci].line;
          // marked's blockquoteSetextReplace: a lazy setext underline that
          // is not the first line of its chunk is indented by 4 spaces, so
          // it stays paragraph text instead of becoming a heading
          if (chunk[ci].lazy && ci > 0 && setextLevel(ln) === 1) ln = '    ' + ln.trim();
          chunkLines.push(ln);
          chunkLazy.push(chunk[ci].lazy);
        }
        const chunkBlocks = parseBlocks(chunkLines, refs, chunkLazy, false);
        mergeChunkBlocks(allBlocks, chunkBlocks);
      }
      out.push({ k: 'x', s: '<blockquote>\n' + renderBlocks(allBlocks, refs) + '</blockquote>\n' });
      i = j;
      continue;
    }

    // ---- ATX heading ----
    const atx = atxHeading(line);
    if (atx) {
      out.push({ k: 'x', s: '<h' + atx.level + '>' + parseInline(atx.text, refs) + '</h' + atx.level + '>\n' });
      i++;
      continue;
    }

    // ---- fenced code ----
    const fence = fenceStart(line);
    if (fence) {
      const content = [];
      let j = i + 1;
      while (j < lines.length && !isFenceEnd(lines[j], fence)) { content.push(lines[j]); j++; }
      if (j < lines.length) j++; // consume the closing fence
      const info = fence.info;
      // marked's fence info: backslash escapes are unescaped, and the
      // lang is NOT &amp;-escaped (entities stay as-is, cm-034)
      const lang = info ? escapeInfo(info.split(/\s+/)[0]) : '';
      // marked's indent compensation: the opening fence's indent is
      // stripped from every content line — but ONLY for backtick
      // fences. Tilde fences keep their content indent verbatim in
      // marked (verified: `  ~~~js` keeps `  code`, while the same
      // backtick fence strips to `code`).
      const findent = fence.char === C_BTICK ? indentCols(line) : 0;
      const stripped = findent > 0 ? content.map(l => stripUpTo(l, findent)) : content;
      // marked's code renderer: strip one trailing newline from the token
      // text (the fence regex already excludes the newline before the
      // closing fence), then add exactly one
      const text = stripped.join('\n');
      const rendered = text ? text.replace(/\n$/, '') + '\n' : '';
      out.push({ k: 'x', s: '<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' + escapeText(rendered) + '</code></pre>\n' });
      i = j;
      continue;
    }

    // ---- thematic break ----
    if (isThematicBreak(line)) {
      out.push({ k: 'x', s: '<hr>\n' });
      i++;
      continue;
    }

    // ---- HTML block ----
    const htype = htmlBlockType(line);
    if (htype > 0) {
      const htmlLines = [line];
      let j = i + 1;
      if (htype === 1) {
        // ends at a line containing the closing tag for the SAME tag that
        // opened it; the closing tag may already be on the first line
        const om = /^<(script|pre|style|textarea)(\s|>|$)/i.exec(line);
        const tag = om ? om[1].toLowerCase() : 'pre';
        const closeRe = new RegExp('</' + tag + '\\s*>', 'i');
        if (!closeRe.test(line)) {
          while (j < lines.length && !closeRe.test(lines[j])) { htmlLines.push(lines[j]); j++; }
          if (j < lines.length) { htmlLines.push(lines[j]); j++; }
        }
      } else if (htype === 2 || htype === 3 || htype === 4 || htype === 5) {
        // ends at a line containing the end marker; the first line may
        // already contain it
        if (!htmlBlockEnds(line, htype)) {
          while (j < lines.length) {
            htmlLines.push(lines[j]);
            if (htmlBlockEnds(lines[j], htype)) { j++; break; }
            j++;
          }
        }
      } else {
        // types 6 and 7: continue until a blank line
        while (j < lines.length && !isBlank(lines[j])) { htmlLines.push(lines[j]); j++; }
      }
      // marked's html tokenizer trims trailing blank lines (ge): a block
      // that ends at a blank line has NO trailing newline; one that ends
      // mid-document keeps it (more lines follow); one that ends at EOF
      // keeps it only when the source ends with a newline (gfm-657).
      // "Blank" here is ONLY a truly empty line: a spaces-only or
      // tab-only line after the block does NOT strip the trailing
      // newline (doc-19: `   ` after `-->` keeps `\n`; doc-15: `\t`
      // after `-->` keeps `\n`).
      const nextLine = j < lines.length ? lines[j] : null;
      const endedAtBlank = nextLine !== null && nextLine === '';
      const keepNl = !endedAtBlank && (j < lines.length || endsNl);
      out.push({ k: 'x', s: htmlLines.join('\n') + (keepNl ? '\n' : '') });
      i = j;
      continue;
    }

    // ---- indented code ----
    if (ind >= 4) {
      const codeLines = [];
      let j = i;
      while (j < lines.length) {
        const ln = lines[j];
        if (isBlank(ln)) {
          // a blank line ends the code block unless the next line is also
          // indented code; a kept blank line contributes its content
          // minus the 4-space indent (it is not empty)
          let k = j + 1;
          while (k < lines.length && isBlank(lines[k])) k++;
          if (k < lines.length && indentCols(lines[k]) >= 4) {
            while (j < k) { codeLines.push(stripColumns(lines[j], 4)); j++; }
            continue;
          }
          break;
        }
        if (indentCols(ln) < 4) break;
        codeLines.push(stripColumns(ln, 4));
        j++;
      }
      // drop trailing blank lines
      while (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') codeLines.pop();
      // k:'c' carries the code text (no trailing newline) so a later
      // chunk can merge it into an open paragraph (marked's code merge)
      out.push({ k: 'c', text: codeLines.join('\n') });
      i = j;
      continue;
    }

    // ---- list ----
    const lm = listMarker(line);
    if (lm) {
      const listBlocks = parseList(lines, i, refs);
      out.push(...listBlocks.blocks);
      i = listBlocks.next;
      continue;
    }

    // ---- link reference definition (a block-level rule) ----
    // tryLinkRefDef is defined with the link helpers above. A definition is
    // only recognised at a block start; inside a paragraph it is plain text.
    {
      const def = tryLinkRefDef(lines, i);
      if (def) {
        const key = normalizeLabel(def.label);
        if (!refs.has(key)) refs.set(key, { href: def.href, title: def.title });
        i = def.next;
        continue;
      }
    }

    // ---- paragraph / setext heading / table ----
    // A table is tried first: the first line is the header and the next
    // line the delimiter, with matching cell counts.
    if (i + 1 < lines.length) {
      const delim0 = isRealTableDelimiter(lines[i + 1]);
      if (delim0) {
        const headerCells0 = splitTableRow(line);
        if (headerCells0.length === delim0.length && headerCells0.length > 0) {
          const table = parseTable(lines, i, headerCells0, delim0, refs);
          out.push({ k: 'x', s: table.html });
          i = table.next;
          continue;
        }
      }
    }
    {
      const paraLines = [line];
      const paraLazy = [isLazyLine];
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j];
        if (isBlank(ln)) {
          // marked's paragraph regex blocks a whitespace-only line only
          // when it is followed by a newline ([ \t]+\n lookahead). In
          // container inner text there is no trailing newline, so a
          // whitespace-only line at the very end IS a continuation
          // (cm-241: `> foo\n>  ` -> paragraph "foo\n ")
          if (ln.length > 0 && j === lines.length - 1 && !topLevel) {
            paraLines.push(ln); paraLazy.push(false); j++; continue;
          }
          break;
        }
        // an indented line cannot interrupt a paragraph: it joins it as a
        // continuation, keeping its leading spaces (a top-level paragraph
        // keeps them; only a tight list item's text token strips the
        // 4-space code indent — handled in parseList)
        if (indentCols(ln) >= 4) { paraLines.push(ln); paraLazy.push(false); j++; continue; }
        if (atxHeading(ln)) break;
        if (isThematicBreak(ln)) break;
        if (fenceStart(ln)) break;
        if (paragraphHtmlInterrupt(ln)) break;
        if (stripQuotePrefix(ln).had) break;
        const lm2 = listMarker(ln);
        // a list interrupts a paragraph when it is a bullet list or an
        // ordered list starting with 1 — except inside a list item,
        // where ANY ordered marker interrupts (marked's list-item
        // lexing; doc-01's 505791. nested list)
        if (lm2 && (!lm2.ordered || lm2.start === 1 || inList)) {
          const fc = listItemFirstContent(ln, lm2);
          if (fc.text.trim() !== '') break;
        }
        // a table header line (followed by a delimiter) ends the paragraph
        if (j + 1 < lines.length && indentCols(ln) <= 3 && !isBlank(ln) && isRealTableDelimiter(lines[j + 1])) break;
        // a setext underline ends the paragraph — unless it is a lazy line,
        // in which case it stays paragraph text (marked's blockquote
        // setext handling)
        if (setextLevel(ln) > 0) {
          if (isLazyLineAt(lazy, j)) { paraLines.push(ln); paraLazy.push(true); j++; continue; }
          break;
        }
        paraLines.push(ln); paraLazy.push(false); j++;
      }
      // setext heading: the next line is a setext underline that is NOT a
      // lazy line (a lazy underline stays paragraph text)
      if (j < lines.length && setextLevel(lines[j]) > 0 && !isLazyLineAt(lazy, j)) {
        const level = setextLevel(lines[j]);
        // marked's lheading trims the heading text
        const text = paraLines.join('\n').trim();
        out.push({ k: 'x', s: '<h' + level + '>' + parseInline(text, refs) + '</h' + level + '>\n' });
        i = j + 1;
        continue;
      }
      out.push({ k: 'p', text: paraLines.join('\n') });
      i = j;
      continue;
    }
  }
  out.blankGap = hadBlankGap;
  return out;
}

function isLazyLineAt(lazy, idx) {
  return lazy ? !!lazy[idx] : false;
}

// ---------------------------------------------------------------------------
// List parsing
// ---------------------------------------------------------------------------
// A tight list item's first paragraph is a "text" token in marked: its
// continuation lines are lexed one at a time, so a line indented 4+ is an
// indented-code token merged into the text with its 4-space indent
// stripped. Reproduce that for the first paragraph of a tight item.
function textTokenText(text) {
  const ls = text.split('\n');
  for (let k = 1; k < ls.length; k++) {
    if (indentCols(ls[k]) >= 4) ls[k] = stripColumns(ls[k], 4);
  }
  return ls.join('\n');
}

// Parse a list starting at lines[start]. Returns {blocks, next}: the
// rendered list as a single block, and the index of the first line after it.
function parseList(lines, start, refs) {
  const first = listMarker(lines[start]);
  const ordered = first.ordered;
  const delim = first.delim;
  const startNum = first.start;
  const items = [];
  let loose = false;
  let i = start;
  // the content indent of the most recent item: a new item of this list
  // must have a marker indented less than it (marked's nextBulletRegex);
  // starts large so the first item always passes
  let prevContentIndent = 100;
  while (i < lines.length) {
    const ln = lines[i];
    const lm = listMarker(ln);
    if (!lm || lm.ordered !== ordered || lm.delim !== delim || lm.indent >= prevContentIndent) break;
    const fc = listItemFirstContent(ln, lm);
    const contentIndent = fc.contentIndent;
    prevContentIndent = contentIndent;
    const itemLines = [fc.text];
    const itemLazy = [false];
    // Fence state inside this item: while a fenced code block is open,
    // every line is fence content (even at column 0) until the closing
    // fence (doc-02: `function f(a, b) {` inside a ```css block).
    // The fence may open on the item's first line (cm-318: `- ```).
    // BUT the FIRST content line after the fence opens must be
    // indented to the item's content level (or blank); a column-0
    // line right after the opening fence is NOT part of the item, so
    // the fence is EMPTY and the line starts a new top-level block
    // (doc-17: `   ```toml` followed by `if my-package previous` at
    // column 0). Once the fence has absorbed one content line, later
    // column-0 lines ARE fence content (doc-02).
    let fence = fenceStart(fc.text);
    let fenceHasContent = false;
    let j = i + 1;
    while (j < lines.length) {
      const l2 = lines[j];
      if (fence) {
        // The first content line must be indented to the item level
        // (or blank / the closing fence); otherwise the fence is
        // empty and this line ends the item (doc-17).
        if (!fenceHasContent && !isBlank(l2) && !isFenceEnd(l2, fence) && indentCols(l2) < contentIndent) {
          fence = null;
          break;
        }
        // fence content: blank lines included, indent stripped when present
        const stripped = indentCols(l2) >= contentIndent ? stripColumnsExpanded(l2, contentIndent) : l2;
        itemLines.push(stripped); itemLazy.push(false); j++;
        if (isFenceEnd(stripped, fence)) fence = null;
        else fenceHasContent = true;
        continue;
      }
      if (isBlank(l2)) {
        // look ahead to the next non-blank line
        let k = j + 1;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k >= lines.length) { j = k; break; }
        const nk = lines[k];
        const nlm = listMarker(nk);
        // a thematic break ends the list (marked checks hr before list);
        // leave j at the blank line so the enclosing parse sees the gap
        if (isThematicBreak(nk)) break;
        if (nlm && nlm.ordered === ordered && nlm.delim === delim && nlm.indent < contentIndent) {
          // blank line(s) between items: the list is loose
          loose = true;
          j = k;
          break;
        }
        // an empty item ends at a blank line: indented content after it
        // is not part of the item (cm-280: `-\n\n  foo` -> empty <li>
        // and a separate paragraph). Leave j at the blank line so the
        // enclosing parse sees the gap. (A following item of the same
        // list is handled above, cm-315.)
        if (itemLines.length === 1 && itemLines[0] === '') break;
        if (indentCols(nk) >= contentIndent) {
          // the item continues after a blank line (looseness for this is
          // decided later from the item's own blocks, not here — a blank
          // line inside a nested list must not loosen this list)
          while (j < k) { itemLines.push(''); itemLazy.push(false); j++; }
          continue;
        }
        // the next non-blank line is not part of this item: end the item
        // WITHOUT skipping the blank lines, so the enclosing parse sees
        // the gap (it decides looseness from its own blocks)
        break;
      }
      if (indentCols(l2) >= contentIndent) {
        // a content line (possibly a nested list): strip the content indent
        // (tabs expanded first, marked's item text, cm-005)
        const stripped = stripColumnsExpanded(l2, contentIndent);
        itemLines.push(stripped);
        itemLazy.push(false);
        j++;
        const fs = fenceStart(stripped);
        if (fs) fence = fs;
        continue;
      }
      // a line with less indent than the content column: a new item of this
      // list, a different list, or a lazy continuation of the item's
      // paragraph — never a content line
      const lm2 = listMarker(l2);
      if (lm2) break; // any list marker at this level ends the item
      if (paragraphOpenAtEnd(itemLines) && isContinuationLine(l2)) {
        itemLines.push(l2);
        itemLazy.push(true);
        j++;
        continue;
      }
      break;
    }
    items.push({ lines: itemLines, lazy: itemLazy });
    i = j;
    if (i >= lines.length) break;
    // a thematic break ends the list (marked checks hr before list)
    if (isThematicBreak(lines[i])) break;
    const nm = listMarker(lines[i]);
    if (!nm || nm.ordered !== ordered || nm.delim !== delim || nm.indent >= prevContentIndent) break;
  }
  // parse every item's blocks first: a list is loose when any item's own
  // blocks are separated by a blank line (marked's space token), or when
  // items are separated by blank lines (set above)
  const parsedItems = items.map(item => parseBlocks(item.lines, refs, item.lazy, false, false, true));
  for (const blocks of parsedItems) if (blocks.blankGap) loose = true;
  let s = ordered
    ? '<ol' + (startNum !== 1 ? ' start="' + startNum + '"' : '') + '>\n'
    : '<ul>\n';
  for (const blocks of parsedItems) {
    // GFM task list: the item's first paragraph may start with [ ] or
    // [x]/[X] followed by a space; it renders as a checkbox input
    let taskHtml = '';
    if (blocks.length > 0 && blocks[0].k === 'p') {
      const m = /^\[([ xX])\] /.exec(blocks[0].text);
      if (m) {
        taskHtml = m[1] === ' '
          ? '<input disabled="" type="checkbox"> '
          : '<input checked="" disabled="" type="checkbox"> ';
        blocks[0].text = blocks[0].text.slice(m[0].length);
      }
    }
    let content;
    if (!loose) {
      // tight list: paragraphs render without <p> tags; the first
      // paragraph is a text token (indented lines lose 4 columns)
      content = taskHtml;
      let first = true;
      for (const b of blocks) {
        if (b.k === 'p') {
          content += parseInline(first ? textTokenText(b.text) : b.text, refs);
        } else content += renderBlock(b, refs);
        first = false;
      }
    } else if (taskHtml) {
      // loose list: the checkbox goes INSIDE the first <p> (doc-01)
      content = '<p>' + taskHtml + parseInline(blocks[0].text, refs) + '</p>\n';
      for (let bi = 1; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b.k === 'p') content += '<p>' + parseInline(b.text, refs) + '</p>\n';
        else content += renderBlock(b, refs);
      }
    } else {
      content = renderBlocks(blocks, refs);
    }
    s += '<li>' + content + '</li>\n';
  }
  s += ordered ? '</ol>\n' : '</ul>\n';
  return { blocks: [{ k: 'x', s }], next: i };
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------
function parseTable(lines, start, headerCells, delim, refs) {
  const aligns = delim;
  const alignAttr = (a) => a === 'l' ? ' align="left"' : a === 'c' ? ' align="center"' : a === 'r' ? ' align="right"' : '';
  let html = '<table>\n<thead>\n<tr>\n';
  for (let c = 0; c < headerCells.length; c++) {
    html += '<th' + alignAttr(aligns[c]) + '>' + parseInline(headerCells[c], refs) + '</th>\n';
  }
  html += '</tr>\n</thead>\n';
  const rows = [];
  let j = start + 2;
  while (j < lines.length && !tableBodyEnds(lines[j])) {
    rows.push(splitTableRow(lines[j], headerCells.length));
    j++;
  }
  if (rows.length > 0) {
    html += '<tbody>';
    for (const row of rows) {
      html += '<tr>\n';
      for (let c = 0; c < row.length; c++) {
        html += '<td' + alignAttr(aligns[c]) + '>' + parseInline(row[c], refs) + '</td>\n';
      }
      html += '</tr>\n';
    }
    html += '</tbody></table>\n';
  } else {
    html += '</table>\n';
  }
  return { html, next: j };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
// parse(markdown) -> HTML, byte-identical to marked 18.1.3 with default
// options (GFM on). Link reference definitions are collected in a pre-pass
// (a definition is only recognised at the start of the document, after a
// blank line, or after another definition — never inside a paragraph), so
// links may refer to definitions that appear later in the document; the
// block parser also recognises definitions at other block starts.
export function parse(markdown) {
  const src = String(markdown).replace(/\r\n?/g, '\n');
  const endsNl = src.endsWith('\n');
  let lines = src.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const refs = new Map();
  inLink = false;
  // Two passes: the first collects every link reference definition in
  // the document (a definition may be used before it appears, cm-214,
  // and marked resolves links only after all blocks are lexed), the
  // second renders with the complete ref map. Definitions are consumed
  // in both passes; refs.set is idempotent.
  parseBlocks(lines, refs, null, true, endsNl);
  inLink = false;
  const blocks = parseBlocks(lines, refs, null, true, endsNl);
  return renderBlocks(blocks, refs);
}
