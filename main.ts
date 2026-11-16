// Driver for the markdown-render-speed-02 entry.
//
// The harness runs `node /bot/main.ts` on Node 22 (which strips TypeScript
// types natively, so this file uses erasable syntax only). It reads every
// case from /input/cases.json — a JSON array of {"id", "markdown"} — renders
// each one with parse() from parse.js, and writes /output/html.json: a JSON
// array of the HTML strings, one per case, in the cases' order.
//
// Outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in
// for /input and /output, so the same driver can be run locally against the
// practice set.
//
// Note (round 2): parse() now tokenizes every paragraph in document order,
// so an unclosed <a> suppresses bare-URL autolinks only for the text that
// follows it in the document. That ordering fix is what takes the practice
// set from 718/720 to 720/720 (the last two failures were doc-06/doc-35).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(
  readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')
) as { id: string; markdown: string }[];

const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
