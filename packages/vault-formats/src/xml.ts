/** Minimal XML parser and escaper for KeePass 2.x / KeePassXC XML exports. */

export interface XmlNode {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlNode[];
}

/** Characters that are illegal in XML 1.0 (control chars, lone surrogates, U+FFFE/U+FFFF). */
const XML_INVALID_CHARS =
  // oxlint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Remove characters that cannot be represented in XML 1.0 (they would make the file unparseable). */
export function stripInvalidXmlChars(value: string): string {
  return value.replace(XML_INVALID_CHARS, "");
}

export function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const XML_NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  amp: "&",
};

/** Single-pass decode so `&#38;lt;` yields the literal text `&lt;` rather than `<`. */
export function unescapeXml(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|quot|apos|amp));/g,
    (match, hex, dec, name) => {
      if (name) return XML_NAMED_ENTITIES[name];
      const codePoint = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : match;
    },
  );
}

function stripXmlComments(input: string): string {
  let result = "";
  let pos = 0;
  while (pos < input.length) {
    if (input.startsWith("<![CDATA[", pos)) {
      const end = input.indexOf("]]>", pos + 9);
      const next = end === -1 ? input.length : end + 3;
      result += input.slice(pos, next);
      pos = next;
      continue;
    }
    if (input.startsWith("<!--", pos)) {
      const end = input.indexOf("-->", pos + 4);
      if (end === -1) throw new Error("Invalid XML: unterminated comment.");
      pos = end + 3;
      continue;
    }
    result += input[pos];
    pos++;
  }
  return result;
}

/**
 * Index of the `>` that ends the tag starting after `from`, ignoring `>` inside quoted attribute
 * values.
 */
function findTagEnd(input: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

export function parseXml(input: string, options: { strict?: boolean } = {}): XmlNode | null {
  const strict = options.strict === true;
  const cleaned = stripXmlComments(input.replace(/^\uFEFF/, "")).replace(
    /^\s*<\?xml[\s\S]*?\?>/i,
    "",
  );

  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let pos = 0;

  while (pos < cleaned.length) {
    const lt = cleaned.indexOf("<", pos);
    if (lt === -1) {
      if (strict && !stack.length && cleaned.slice(pos).trim()) {
        throw new Error("Invalid XML: text outside the root element.");
      }
      break;
    }

    if (lt > pos && stack.length > 0) {
      const rawText = cleaned.slice(pos, lt);
      if (rawText.trim().length > 0 || stack[stack.length - 1].children.length === 0) {
        stack[stack.length - 1].text += unescapeXml(rawText);
      }
    } else if (strict && lt > pos && cleaned.slice(pos, lt).trim()) {
      throw new Error("Invalid XML: text outside the root element.");
    }

    if (cleaned.startsWith("<![CDATA[", lt)) {
      const endCdata = cleaned.indexOf("]]>", lt + 9);
      if (strict && endCdata === -1) throw new Error("Invalid XML: unterminated CDATA section.");
      const cdataText = endCdata === -1 ? cleaned.slice(lt + 9) : cleaned.slice(lt + 9, endCdata);
      if (stack.length > 0) {
        stack[stack.length - 1].text += cdataText;
      } else if (strict) {
        throw new Error("Invalid XML: CDATA outside the root element.");
      }
      pos = endCdata === -1 ? cleaned.length : endCdata + 3;
      continue;
    }

    const gt = findTagEnd(cleaned, lt + 1);
    if (gt === -1) {
      if (strict) throw new Error("Invalid XML: unterminated tag.");
      break;
    }

    const tagContent = cleaned.slice(lt + 1, gt).trim();
    pos = gt + 1;

    if (!tagContent) {
      if (strict) throw new Error("Invalid XML: empty tag.");
      continue;
    }
    if (tagContent.startsWith("!") || tagContent.startsWith("?")) continue;

    if (tagContent.startsWith("/")) {
      const closingTag = tagContent.slice(1).trim();
      if (strict) {
        if (stack.at(-1)?.tag !== closingTag) {
          throw new Error(`Invalid XML: unexpected closing tag </${closingTag}>.`);
        }
        stack.pop();
        continue;
      }
      // A stray closing tag with no matching open element must not unwind the whole stack.
      let matchIdx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === closingTag) {
          matchIdx = i;
          break;
        }
      }
      if (matchIdx !== -1) stack.length = matchIdx;
      continue;
    }

    const selfClosing = tagContent.endsWith("/");
    const body = selfClosing ? tagContent.slice(0, -1).trim() : tagContent;
    const spaceIdx = body.search(/\s/);
    const tag = spaceIdx === -1 ? body : body.slice(0, spaceIdx);
    const attrStr = spaceIdx === -1 ? "" : body.slice(spaceIdx + 1);

    const attributes = Object.create(null) as Record<string, string>;
    const attrRegex = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(attrStr)) !== null) {
      attributes[match[1]] = unescapeXml(match[2] ?? match[3] ?? "");
    }

    const node: XmlNode = { tag, attributes, text: "", children: [] };
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else if (!root) {
      root = node;
    } else if (strict) {
      throw new Error("Invalid XML: multiple root elements.");
    }

    if (!selfClosing) {
      stack.push(node);
    }
  }

  if (strict && stack.length > 0) {
    throw new Error(`Invalid XML: unclosed <${stack.at(-1)?.tag}> element.`);
  }
  if (strict && !root) throw new Error("Invalid XML: missing root element.");

  return root;
}

export function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

export function findChildren(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => c.tag === tag);
}
