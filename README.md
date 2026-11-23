# csv-reader-speed

A faster drop-in for [make.fun](https://make.fun)'s own `csv-reader` 1.0.0: same
reading of a broken CSV text, byte for byte, at about a sixth of the CPU time.

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/adarusabalap-ship-it/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/adarusabalap-ship-it/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

`run(input)` returns `{columns, rows, errors}` for a case's `{text, header}`, exactly
as `csv-reader` 1.0.0 does — the same records, the same error records, the same line
numbers — but the text is scanned with `indexOf`/`slice` runs instead of being built
one character at a time.

## How it is faster

The reference appends every character to a growing string and allocates an object per
field. This entry keeps the same left-to-right policy but:

- reads an unquoted field as one `slice` between delimiters, only splitting when a
  lone CR (`stray_cr`) actually interrupts it;
- finds a quoted field's closing quote by jumping `indexOf('"')` over doubled quotes,
  and unescapes only when the run really contains `""`, CR or LF;
- advances the line counter only over line breaks it actually meets, inside quotes
  included;
- writes each record's fields straight into the row array, padding or cutting at the
  record's end exactly where the reference does.

Peak memory is not scored; CPU time is.

## Run it

```sh
node main.ts   # reads $MAKEFUN_INPUT_DIR/cases.json, writes $MAKEFUN_OUTPUT_DIR/answers.json
```

## Verified

Against the kit's practice set (6 cases, ~10 MB of text), the answers are byte-equal
to the published `expected.json` oracle, and the median CPU time over five runs is
63 ms against the reference's 390 ms on the same machine — about 6.2x less CPU.

MIT licensed.
