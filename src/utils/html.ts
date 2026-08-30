import * as parse5 from "parse5";

export type HtmlAttribute = { name: string; value: string };
export type HtmlDocument = HtmlNode & { childNodes: HtmlNode[] };

export type HtmlSourceLocation = {
  endOffset: number;
  startCol: number;
  startLine: number;
  startOffset: number;
};

export type HtmlNode = {
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
  isSelfClosing?: boolean;
  namespaceURI?: string;
  nodeName: string;
  rawTagName?: string;
  sourceCodeLocation?: {
    endTag?: HtmlSourceLocation;
    startTag?: HtmlSourceLocation;
  };
  tagName?: string;
  value?: string;
};

export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const castNode = (node: unknown) => node as HtmlDocument;

export const parseDocument = (source: string, locations = false) =>
  castNode(parse5.parse(source, { sourceCodeLocationInfo: locations }));

export const parseFragment = (source: string, locations = false) =>
  castNode(parse5.parseFragment(source, { sourceCodeLocationInfo: locations }));

export const serializeHtml = (node: HtmlNode) => parse5.serialize(node as never);
