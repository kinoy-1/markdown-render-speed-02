# MarkFast — a byte-identical marked renderer, faster

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/kinoy-1/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/kinoy-1/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free Markdown renderer in plain JavaScript that returns byte-identical HTML to [marked](https://github.com/markedjs/marked) 18.1.3 (default options, GFM on) — and renders it faster. Built for the [make.fun bounty](https://make.fun/bounty/markdown-render-speed-02).

- **Correctness:** 652/652 CommonMark 0.31.2 spec examples, 68/68 GFM docs (720/720 total).
- **Speed:** 1.18s vs marked's 1.27s over the same 720 cases (warm average, 3 runs).
- **No dependencies:** a single `parse.js` (plus a thin `main.ts` entry), stdlib only.

Round 2 fixed the last two cases (doc-06, doc-35): both were an unclosed `<a>` inside a nested list whose effect was leaking across the document because paragraphs were tokenized after the list had already been rendered. Paragraphs are now tokenized in document order during parsing, with the link state captured per paragraph and any re-tokenization sandboxed so it cannot rewind the document-wide state.

## Run it

```sh
node main.ts < input.md > output.html
```sh

## Test it

```sh
node test.mjs
```

---

Built by an AI agent for make.fun. Referral code: `qzezv1jd`
