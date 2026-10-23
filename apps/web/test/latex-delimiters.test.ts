import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageResponse } from "../src/components/ai-elements/message.tsx";
import { normalizeLatexDelimiters } from "../src/lib/latex-delimiters.ts";

test("normalizes complete scientific inline and display delimiters", () => {
  const input = String.raw`差值定义为 \(d_i=after_i-before_i\)，按输入顺序配对。

\[
\bar d=\frac{\sum d_i}{n},\qquad SE=\frac{s_d}{\sqrt n}
\]`;
  assert.equal(normalizeLatexDelimiters(input), String.raw`差值定义为 $d_i=after_i-before_i$，按输入顺序配对。

$$
\bar d=\frac{\sum d_i}{n},\qquad SE=\frac{s_d}{\sqrt n}
$$`);
  assert.equal(normalizeLatexDelimiters(String.raw`Value \[ x^2 \] follows.`), "Value \n$$\nx^2\n$$\n follows.");
  assert.equal(normalizeLatexDelimiters(String.raw`**\( x_i \)** and \(\$5\)`), String.raw`**$x_i$** and $\$5$`);
});

test("preserves existing dollar math and is idempotent", () => {
  const existing = String.raw`An inline $x_i$ and $$y_i$$, then $\(literal\)$.

$$
\[also literal\]
$$`;
  assert.equal(normalizeLatexDelimiters(existing), existing);
  const normalized = normalizeLatexDelimiters(String.raw`Answer \(x\).

\[y\]`);
  assert.equal(normalizeLatexDelimiters(normalized), normalized);
});

test("preserves fenced code, including longer fences, tildes, and unfinished streams", () => {
  for (const fence of ["```", "````", "~~~"]) {
    const input = [fence + "latex", String.raw`\[x\]`, String.raw`\(y\)`, fence, String.raw`After \(z\).`].join("\n");
    assert.equal(normalizeLatexDelimiters(input), input.replace(String.raw`After \(z\).`, "After $z$."));
    const unfinished = [fence + "latex", String.raw`\[x\]`, String.raw`\(y\)`].join("\n");
    assert.equal(normalizeLatexDelimiters(unfinished), unfinished);
  }
  const nested = ["> ```latex", String.raw`> \[x\]`, "> ```", String.raw`Next \(y\).`].join("\n");
  assert.equal(normalizeLatexDelimiters(nested), nested.replace(String.raw`Next \(y\).`, "Next $y$."));
});

test("preserves inline and indented code without consuming following math", () => {
  const inline = "Use `" + String.raw`\(code\)` + "` or `` a ` " + String.raw`\[code\]` + " ``; then " + String.raw`\(x\).`;
  assert.equal(normalizeLatexDelimiters(inline), inline.replace(String.raw`\(x\).`, "$x$."));
  const indented = [String.raw`    \[code\]`, String.raw`    \(code\)`, "", String.raw`Then \(x\).`].join("\n");
  assert.equal(normalizeLatexDelimiters(indented), indented.replace(String.raw`Then \(x\).`, "Then $x$."));
  const unfinishedCode = "A `" + String.raw`\(code\)`;
  assert.equal(normalizeLatexDelimiters(unfinishedCode), unfinishedCode);
});

test("leaves every incomplete streaming math prefix unchanged", () => {
  const expressions = [String.raw`Before \(x_i+\alpha\)`, [String.raw`Before \[`, String.raw`x_i+\alpha`, String.raw`\]`].join("\n")];
  for (const expression of expressions) {
    for (let length = expression.indexOf("\\") + 1; length < expression.length; length += 1) {
      const prefix = expression.slice(0, length);
      assert.equal(normalizeLatexDelimiters(prefix), prefix);
    }
  }
  assert.equal(normalizeLatexDelimiters(String.raw`Done \(x\); next \(y`), String.raw`Done $x$; next \(y`);
  const crossesCode = "Open " + String.raw`\(x ` + "`code`" + String.raw` y\)`;
  assert.equal(normalizeLatexDelimiters(crossesCode), crossesCode);
});

test("preserves paths, escaped backslash text, links, and HTML code", () => {
  const literal = String.raw`C:\(draft\)\notes.md
./\(draft\)/notes.md
report\(draft\).md
\(draft\).md
\\(literal\\) and \\[literal\\]
Escape sequences: \n \t \alpha.
[data](./\(draft\)/data.csv)
[paper](https://example.org/\(draft\))
<https://example.org/\(draft\)>
[ref]: https://example.org/\(draft\)
<code>\(literal\)</code>
<pre>\[literal\]</pre>
<span data-value="\(literal\)">Text</span>`;
  assert.equal(normalizeLatexDelimiters(literal), literal);
});

test("the shared response renderer produces inline and display KaTeX", () => {
  const html = renderToStaticMarkup(createElement(MessageResponse, {
    children: String.raw`差值为 \(d_i=after_i-before_i\)。

\[
\bar d=\frac{\sum d_i}{n}
\]

Existing $s_d$ is also inline math.`,
    mode: "static",
    isAnimating: false
  }));
  assert.equal(html.match(/class="katex"/g)?.length, 3);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /encoding="application\/x-tex"/);
  assert.doesNotMatch(html, /katex-error/);
});
