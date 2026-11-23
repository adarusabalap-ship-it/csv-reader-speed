// A faster drop-in for csv-reader 1.0.0. Same policy, read with indexOf/slice scans instead of building every
// field one character at a time.
//
// Policy (the reference's, verbatim from vendor/csv-reader/index.js):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and each
//     CRLF or lone CR inside it read as LF; what follows its closing quote, up to the next comma or line break, is
//     appended to it as it stands (quote_junk, when the field ends); a quote that never closes is a literal
//     character, and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it, each padded with
//     "" (short_row, fields: its field count) or cut (long_row, extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met: a field's quote_junk when the field ends, a record's
//     short_row or long_row when the record ends; line is the 1-based line its record starts on (every LF, CRLF and
//     lone CR inside a quoted field counted), row its index in rows, null for the header.

const C_COMMA = 44;
const C_QUOTE = 34;
const C_LF = 10;
const C_CR = 13;

const ENDED_COMMA = 1;
const ENDED_LINE = 2;
const ENDED_END = 3;

/**
 * The reading of one CSV input, {text, header}: {columns, rows, errors}.
 * @param {{text: unknown, header?: unknown}} input
 */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = len > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The index of the quote that closes a field whose opening quote is at open+1, or -1 when none does.
  function findClose(from) {
    let q = from;
    while (q < len) {
      const i = text.indexOf('"', q);
      if (i < 0) return -1;
      if (i + 1 < len && text.charCodeAt(i + 1) === C_QUOTE) {
        q = i + 2;
        continue;
      }
      return i;
    }
    return -1;
  }

  // The quoted run's value: "" -> ", every CRLF or lone CR -> LF, and the line counter advanced over them.
  function unescape(from, to) {
    const seg = text.slice(from, to);
    const n = seg.length;
    if (seg.indexOf('\r') < 0 && seg.indexOf('\n') < 0 && seg.indexOf('""') < 0) return seg;
    let out = '';
    let i = 0;
    while (i < n) {
      const cr = seg.indexOf('\r', i);
      const lf = seg.indexOf('\n', i);
      const dq = seg.indexOf('""', i);
      let next = -1;
      let kind = 0;
      if (cr >= 0 && (next < 0 || cr < next)) { next = cr; kind = 1; }
      if (lf >= 0 && (next < 0 || lf < next)) { next = lf; kind = 2; }
      if (dq >= 0 && (next < 0 || dq < next)) { next = dq; kind = 3; }
      if (next < 0) {
        out += seg.slice(i);
        break;
      }
      if (next > i) out += seg.slice(i, next);
      if (kind === 1) {
        // A CR inside quotes reads as LF; CRLF is one line, a lone CR one line.
        out += '\n';
        line += 1;
        i = next + (next + 1 < n && seg.charCodeAt(next + 1) === C_LF ? 2 : 1);
      } else if (kind === 2) {
        out += '\n';
        line += 1;
        i = next + 1;
      } else {
        out += '"';
        i = next + 2;
      }
    }
    return out;
  }

  // Reads an unquoted run from `pos`, onto `prefix`. Returns [value, ended].
  // A CR not followed by LF is dropped and recorded as stray_cr, on the record's line and row.
  function readUnquoted(prefix, rLine, rRow) {
    let p = pos;
    let scan = p;
    let out = prefix;
    let ln = line;
    while (p < len) {
      const c = text.charCodeAt(p);
      if (c === C_COMMA) {
        if (scan < p) out += text.slice(scan, p);
        pos = p + 1;
        line = ln;
        return [out, ENDED_COMMA];
      }
      if (c === C_LF) {
        if (scan < p) out += text.slice(scan, p);
        pos = p + 1;
        line = ln + 1;
        return [out, ENDED_LINE];
      }
      if (c === C_CR) {
        if (p + 1 < len && text.charCodeAt(p + 1) === C_LF) {
          if (scan < p) out += text.slice(scan, p);
          pos = p + 2;
          line = ln + 1;
          return [out, ENDED_LINE];
        }
        // A lone CR outside quotes is dropped.
        if (scan < p) out += text.slice(scan, p);
        errors.push({ code: 'stray_cr', line: rLine, row: rRow });
        p += 1;
        scan = p;
        continue;
      }
      p += 1;
    }
    if (scan < p) out += text.slice(scan, p);
    pos = p;
    line = ln;
    return [out, ENDED_END];
  }

  // Reads a quoted field whose opening quote is at `pos`, onto `prefix` (the quote_junk append case).
  function readQuoted(prefix, rLine, rRow) {
    const open = pos;
    const openLine = line;
    const qEnd = findClose(pos + 1);
    if (qEnd < 0) {
      // The quote never closes: it is a literal character; the text after it is read again as unquoted.
      line = openLine;
      pos = open + 1;
      errors.push({ code: 'unterminated_quote', line: rLine, row: rRow });
      return readUnquoted(prefix + '"', rLine, rRow);
    }
    const out = prefix + unescape(pos + 1, qEnd);
    pos = qEnd + 1;
    if (pos >= len) return [out, ENDED_END];
    const c = text.charCodeAt(pos);
    if (c === C_COMMA) {
      pos += 1;
      return [out, ENDED_COMMA];
    }
    if (c === C_LF) {
      pos += 1;
      line += 1;
      return [out, ENDED_LINE];
    }
    if (c === C_CR && pos + 1 < len && text.charCodeAt(pos + 1) === C_LF) {
      pos += 2;
      line += 1;
      return [out, ENDED_LINE];
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const before = out.length;
    const r = readUnquoted(out, rLine, rRow);
    if (r[0].length > before) errors.push({ code: 'quote_junk', line: rLine, row: rRow });
    return r;
  }

  while (true) {
    // Blank lines are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === C_LF) {
        pos += 1;
        line += 1;
      } else if (c === C_CR && pos + 1 < len && text.charCodeAt(pos + 1) === C_LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let wasQuoted = false;
    let ended;
    let value;
    do {
      if (text.charCodeAt(pos) === C_QUOTE) {
        wasQuoted = true;
        [value, ended] = readQuoted('', recordLine, recordRow);
      } else {
        [value, ended] = readUnquoted('', recordLine, recordRow);
      }
      fields.push(value);
    } while (ended === ENDED_COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !wasQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
