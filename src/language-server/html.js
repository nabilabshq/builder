import * as parse5 from "parse5";

const htmlNamespace = "http://www.w3.org/1999/xhtml";

export const offsetAt = (text, position) => {
  const lines = text.split("\n");
  const line = Math.min(position.line, lines.length - 1);
  return (
    lines.slice(0, line).reduce((offset, value) => offset + value.length + 1, 0) +
    Math.min(position.character, lines[line].length)
  );
};

export const positionAt = (text, offset) => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, safeOffset);
  const line = before.split("\n");
  return { line: line.length - 1, character: line.at(-1).length };
};

export const rangeAt = (text, start, end) => ({ start: positionAt(text, start), end: positionAt(text, end) });

const attributesFrom = (source) => {
  const attributes = new Map();
  const pattern = /([\w:-]+)\s*=\s*(["'])(.*?)\2/g;
  let match;
  while ((match = pattern.exec(source))) attributes.set(match[1].toLowerCase(), match[3]);
  return attributes;
};

export const tagContextAt = (text, offset) => {
  const start = text.lastIndexOf("<", offset);
  if (start < 0) return;
  const closing = text.indexOf(">", start);
  if (closing !== -1 && closing < offset) return;
  const source = text.slice(start, offset);
  const tag = /^<\s*([\w:-]+)/.exec(source)?.[1]?.toLowerCase();
  if (!tag) return;
  const active = /([\w:-]+)\s*=\s*(["'])([^"']*)$/.exec(source);
  if (active) {
    const prefixStart = offset - active[3].length;
    return {
      tag,
      start,
      attributes: attributesFrom(source),
      attribute: active[1].toLowerCase(),
      prefix: active[3],
      range: rangeAt(text, prefixStart, offset),
    };
  }
  const partial = /(?:^|\s)([\w:-]*)$/.exec(source);
  const prefix = partial?.[1] ?? "";
  return {
    tag,
    start,
    attributes: attributesFrom(source),
    attributeNamePrefix: prefix,
    attributeNameRange: rangeAt(text, offset - prefix.length, offset),
  };
};

export const directParentUse = (text, tagStart) => {
  const stack = [];
  const pattern = /<\s*(\/?)\s*([\w:-]+)([^<>]*)>/g;
  let match;
  const before = text.slice(0, tagStart);
  while ((match = pattern.exec(before))) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag !== tag) continue;
        stack.splice(index, 1);
        break;
      }
      continue;
    }
    if (!/\/\s*$/.test(match[0])) stack.push({ tag, attributes: attributesFrom(match[3]) });
  }
  const parent = stack.at(-1);
  return parent?.tag === "use" && parent.attributes.get("ref") ? parent : undefined;
};

export const parseHtml = (text) => parse5.parse(text, { sourceCodeLocationInfo: true });

export const visitElements = (node, callback, parent) => {
  if (node.tagName) callback(node, parent);
  for (const child of node.childNodes ?? []) visitElements(child, callback, node);
};

export const isHtmlElement = (node, tag) => node.tagName === tag && node.namespaceURI === htmlNamespace;

export const attributeValueOffsets = ({ text, node, attribute }) => {
  const location = node.sourceCodeLocation?.attrs?.[attribute.name];
  if (!location) return { start: 0, end: 0 };
  const raw = text.slice(location.startOffset, location.endOffset);
  const equals = raw.indexOf("=");
  if (equals < 0) return { start: location.startOffset, end: location.endOffset };
  const quote = raw.slice(equals + 1).match(/^\s*(["'])/);
  if (!quote) return { start: location.startOffset + equals + 1, end: location.endOffset };
  const valueStart = location.startOffset + equals + 1 + quote[0].length;
  const valueEnd = Math.max(valueStart, location.endOffset - 1);
  return { start: valueStart, end: valueEnd };
};

export const attributeValueRange = ({ text, node, attribute }) => {
  const { start, end } = attributeValueOffsets({ text, node, attribute });
  return rangeAt(text, start, end);
};

export const elementRange = ({ text, node }) => {
  const location = node.sourceCodeLocation?.startTag;
  return location ? rangeAt(text, location.startOffset, location.endOffset) : rangeAt(text, 0, 0);
};
