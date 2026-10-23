/**
 * Accept the LaTeX delimiters commonly emitted by models without changing the
 * saved response. Only complete pairs outside Markdown code and link targets
 * are rewritten, so a streaming prefix stays intact until its closer arrives.
 */
export function normalizeLatexDelimiters(markdown: string): string {
  let output = "";
  let index = 0;

  while (index < markdown.length) {
    if (index === 0 || markdown[index - 1] === "\n") {
      const protectedEnd = protectedBlockEnd(markdown, index);
      if (protectedEnd !== undefined) {
        output += markdown.slice(index, protectedEnd);
        index = protectedEnd;
        continue;
      }
    }

    if (markdown[index] === "`") {
      const end = codeSpanEnd(markdown, index);
      output += markdown.slice(index, end);
      index = end;
      continue;
    }

    if (markdown[index] === "]" && markdown[index + 1] === "(") {
      const end = linkTargetEnd(markdown, index + 1);
      output += markdown.slice(index, end);
      index = end;
      continue;
    }

    // Preserve autolinks, HTML tags and attributes, and literal HTML code.
    if (markdown[index] === "<") {
      const codeTag = /^<(pre|code)(?:\s[^>]*|)>/i.exec(markdown.slice(index));
      const tagEnd = markdown.indexOf(">", index + 1);
      if (codeTag) {
        const closer = new RegExp(`</${codeTag[1]}>`, "ig");
        closer.lastIndex = index + codeTag[0].length;
        const closingTag = closer.exec(markdown);
        const end = closingTag ? closer.lastIndex : markdown.length;
        output += markdown.slice(index, end);
        index = end;
        continue;
      }
      if (tagEnd !== -1 && !markdown.slice(index, tagEnd).includes("\n")) {
        output += markdown.slice(index, tagEnd + 1);
        index = tagEnd + 1;
        continue;
      }
    }

    if (markdown[index] === "$" && !isEscaped(markdown, index)) {
      const end = dollarMathEnd(markdown, index);
      if (end !== undefined) {
        output += markdown.slice(index, end);
        index = end;
        continue;
      }
    }

    const display = isDelimiter(markdown, index, "[");
    if ((display || isDelimiter(markdown, index, "(")) && !isPathOpening(markdown, index)) {
      const close = mathCloser(markdown, index + 2, display ? "]" : ")");
      if (close === undefined) {
        output += markdown.slice(index);
        break;
      }
      const end = close + 2;
      const body = markdown.slice(index + 2, close).trim();
      if (!body || isPathEnding(markdown.slice(end))) {
        output += markdown.slice(index, end);
      } else if (display) {
        const lineStart = markdown.lastIndexOf("\n", index - 1) + 1;
        const lineEnd = markdown.indexOf("\n", end);
        const prefix = markdown.slice(lineStart, index).trim() ? "\n" : "";
        const suffix = markdown.slice(end, lineEnd === -1 ? markdown.length : lineEnd).trim() ? "\n" : "";
        output += `${prefix}$$\n${body}\n$$${suffix}`;
      } else {
        output += `$${body}$`;
      }
      index = end;
      continue;
    }

    output += markdown[index];
    index += 1;
  }

  return output;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function isDelimiter(text: string, index: number, bracket: string): boolean {
  return text[index] === "\\" && text[index + 1] === bracket && text[index - 1] !== "\\";
}

function isPathOpening(text: string, index: number): boolean {
  const previous = text[index - 1] ?? "";
  // A delimiter attached to a filename, drive, or directory is literal text.
  return /[\w./~\\$]/.test(previous) || /(?:^|[\s("'])\w:$/.test(text.slice(Math.max(0, index - 4), index));
}

function isPathEnding(rest: string): boolean {
  return /^[\\/$]/.test(rest) || /^\.[a-z\d]{1,10}(?:\b|[\\/])/i.test(rest);
}

function mathCloser(text: string, start: number, bracket: ")" | "]"): number | undefined {
  for (let index = start; index < text.length; index += 1) {
    if (isDelimiter(text, index, bracket)) return index;
    if (text[index] === "`" || (text[index] === "$" && !isEscaped(text, index))) return undefined;
    if (isDelimiter(text, index, "(") || isDelimiter(text, index, "[")) return undefined;
    if (bracket === ")" && /^\r?\n[ \t]*\r?\n/.test(text.slice(index))) return undefined;
  }
  return undefined;
}

function lineEnd(text: string, start: number): number {
  const end = text.indexOf("\n", start);
  return end === -1 ? text.length : end + 1;
}

function protectedBlockEnd(text: string, start: number): number | undefined {
  const end = lineEnd(text, start);
  const line = text.slice(start, end).replace(/\r?\n$/, "");
  const fence = /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})/.exec(line)?.[1];
  if (fence) {
    let cursor = end;
    while (cursor < text.length) {
      const nextEnd = lineEnd(text, cursor);
      const closer = /^[ \t]*(?:>[ \t]*)*([`~]+)[ \t]*\r?$/.exec(text.slice(cursor, nextEnd).replace(/\n$/, ""))?.[1];
      if (closer && closer[0] === fence[0] && closer.length >= fence.length) return nextEnd;
      cursor = nextEnd;
    }
    return text.length;
  }
  if (/^(?: {4}|\t)/.test(line) || /^[ \t]{0,3}\[[^\]]+\]:[ \t]*/.test(line)) return end;
  return undefined;
}

function codeSpanEnd(text: string, start: number): number {
  let runEnd = start;
  while (text[runEnd] === "`") runEnd += 1;
  const length = runEnd - start;
  for (let index = runEnd; index < text.length; index += 1) {
    if (text[index] !== "`") continue;
    let end = index;
    while (text[end] === "`") end += 1;
    if (end - index === length) return end;
    index = end - 1;
  }
  return text.length;
}

function linkTargetEnd(text: string, start: number): number {
  let depth = 1;
  for (let index = start + 1; index < text.length; index += 1) {
    if (isEscaped(text, index)) continue;
    if (text[index] === "(") depth += 1;
    if (text[index] === ")" && --depth === 0) return index + 1;
  }
  return text.length;
}

function dollarMathEnd(text: string, start: number): number | undefined {
  const length = text[start + 1] === "$" ? 2 : 1;
  for (let index = start + length; index < text.length; index += 1) {
    if (text[index] !== "$" || isEscaped(text, index)) continue;
    let end = index;
    while (text[end] === "$") end += 1;
    if (end - index === length) return end;
    index = end - 1;
  }
  return undefined;
}
