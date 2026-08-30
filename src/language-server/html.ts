import * as parse5 from "parse5";
import type { Position, Range } from "vscode-languageserver/node.js";

import { HTML_NAMESPACE } from "@/utils/html";

export type HtmlAttribute = { name: string; value: string };
export type HtmlLocation = { endOffset: number; startOffset: number };
export type HtmlElement = {
  attrs?: HtmlAttribute[];
  childNodes?: HtmlElement[];
  namespaceURI?: string;
  nodeName?: string;
  sourceCodeLocation?: { attrs?: Record<string, HtmlLocation>; startTag?: HtmlLocation };
  tagName?: string;
  value?: string;
};

export type TagCursor = {
  attribute?: string;
  attributeNamePrefix?: string;
  attributeNameRange?: Range;
  attributes: Map<string, string>;
  prefix?: string;
  range?: Range;
  start: number;
  tag: string;
};

type AttributeValueOffsets = {
  attribute: HtmlAttribute;
  node: HtmlElement;
  text: string;
};

type AttributeValueRange = {
  attribute: HtmlAttribute;
  node: HtmlElement;
  text: string;
};

export const offsetAt = (text: string, position: Position) => {
  const lines = text.split("\n");
  const line = Math.min(position.line, lines.length - 1);

  return (
    lines.slice(0, line).reduce((offset, value) => offset + value.length + 1, 0) +
    Math.min(position.character, lines[line]?.length ?? 0)
  );
};

const positionAt = (text: string, offset: number): Position => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const line = text.slice(0, safeOffset).split("\n");

  return {
    character: line.at(-1)?.length ?? 0,
    line: line.length - 1,
  };
};

export const rangeAt = (text: string, start: number, end: number): Range => ({
  end: positionAt(text, end),
  start: positionAt(text, start),
});

const attributesFrom = (source: string) => {
  const attributes = new Map<string, string>();
  const pattern = /([\w:-]+)\s*=\s*(["'])(.*?)\2/g;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    attributes.set(match[1].toLowerCase(), match[3]);
  }

  return attributes;
};

export const tagContextAt = (text: string, offset: number): TagCursor | undefined => {
  const start = text.lastIndexOf("<", offset);

  if (start < 0) return;

  const closing = text.indexOf(">", start);

  if (closing !== -1 && closing < offset) return;

  const source = text.slice(start, offset);
  const tagSource = text.slice(start, closing === -1 ? offset : closing);
  const tag = /^<\s*([\w:-]+)/.exec(source)?.[1]?.toLowerCase();

  if (!tag) return;

  const active = /([\w:-]+)\s*=\s*(["'])([^"']*)$/.exec(source);

  if (active) {
    const prefixStart = offset - active[3].length;
    const valueEnd = text.indexOf(active[2], offset);

    return {
      attribute: active[1].toLowerCase(),
      attributes: attributesFrom(tagSource),
      prefix: active[3],
      range: rangeAt(text, prefixStart, valueEnd === -1 ? offset : valueEnd),
      start,
      tag,
    };
  }

  const partial = /(?:^|\s)([\w:-]*)$/.exec(source);
  const prefix = partial?.[1] ?? "";

  return {
    attributeNamePrefix: prefix,
    attributeNameRange: rangeAt(text, offset - prefix.length, offset),
    attributes: attributesFrom(tagSource),
    start,
    tag,
  };
};

export const directParentUse = (text: string, tagStart: number) => {
  const stack: { attributes: Map<string, string>; tag: string }[] = [];
  const pattern = /<\s*(\/?)\s*([\w:-]+)([^<>]*)>/g;

  let match: RegExpExecArray | null;

  const before = text.slice(0, tagStart);

  while ((match = pattern.exec(before))) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();

    if (closing) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index]?.tag !== tag) continue;

        stack.splice(index, 1);
        break;
      }

      continue;
    }

    if (!/\/\s*$/.test(match[0])) stack.push({ attributes: attributesFrom(match[3]), tag });
  }

  const parent = stack.at(-1);

  return parent?.tag === "use" && parent.attributes.get("ref") ? parent : undefined;
};

export const parseHtml = (text: string) => parse5.parse(text, { sourceCodeLocationInfo: true }) as HtmlElement;

export const visitElements = (
  node: HtmlElement,
  callback: (node: HtmlElement, parent?: HtmlElement) => void,
  parent?: HtmlElement,
) => {
  if (node.tagName) callback(node, parent);

  for (const child of node.childNodes ?? []) visitElements(child, callback, node);
};

export const isHtmlElement = (node: HtmlElement, tag: string) =>
  node.tagName === tag && node.namespaceURI === HTML_NAMESPACE;

export const attributeValueOffsets = ({ attribute, node, text }: AttributeValueOffsets) => {
  const location = node.sourceCodeLocation?.attrs?.[attribute.name];

  if (!location) {
    return {
      end: 0,
      start: 0,
    };
  }

  const raw = text.slice(location.startOffset, location.endOffset);
  const equals = raw.indexOf("=");

  if (equals < 0) {
    return {
      end: location.endOffset,
      start: location.startOffset,
    };
  }

  const quote = raw.slice(equals + 1).match(/^\s*(["'])/);

  if (!quote) {
    return {
      end: location.endOffset,
      start: location.startOffset + equals + 1,
    };
  }

  const valueStart = location.startOffset + equals + 1 + quote[0].length;

  return {
    end: Math.max(valueStart, location.endOffset - 1),
    start: valueStart,
  };
};

export const attributeValueRange = ({ attribute, node, text }: AttributeValueRange) => {
  const { end, start } = attributeValueOffsets({ attribute, node, text });

  return rangeAt(text, start, end);
};

export const elementRange = ({ node, text }: { node: HtmlElement; text: string }) => {
  const location = node.sourceCodeLocation?.startTag;

  return location ? rangeAt(text, location.startOffset, location.endOffset) : rangeAt(text, 0, 0);
};
