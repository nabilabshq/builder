import type { HtmlNode } from "@/utils/html";
import { HTML_NAMESPACE, parseDocument as parseHtmlDocument, parseFragment as parseHtmlFragment } from "@/utils/html";

export const compactUseAttribute = "data-nabi-self-closing";
export const internalUseAttributes = new Set(["ref", "slot", compactUseAttribute]);
export const propsPlaceholderAttribute = "data-nabi-props-placeholder";
export const reservedPlaceholders = new Set(["children", "slot"]);

export const normaliseCompactTags = (source: string) =>
  source
    .replace(/<slot(\s[^>]*)?\/\s*>/gi, "<slot$1></slot>")
    .replace(/<script(?=\s[^>]*\buse\s*=)(\s[^>]*)?\/\s*>/gi, "<script$1></script>")
    .replace(/<use\b([^>]*\bref\s*=[^>]*)\/\s*>/gi, `<use$1 ${compactUseAttribute}=""></use>`);

const annotateTagNames = (node: HtmlNode, source: string) => {
  if (node.tagName && node.sourceCodeLocation?.startTag) {
    const openingTag = source.slice(
      node.sourceCodeLocation.startTag.startOffset,
      node.sourceCodeLocation.startTag.endOffset,
    );

    node.rawTagName = /^<\s*([^\s/>]+)/.exec(openingTag)?.[1] ?? node.tagName;
    node.isSelfClosing = /\/\s*>$/.test(openingTag);
  }

  for (const child of node.childNodes ?? []) annotateTagNames(child, source);
};

export const parseDocument = (source: string) => {
  const document = parseHtmlDocument(source, true);

  annotateTagNames(document, source);

  return document;
};

export const parseFragment = (source: string) => {
  const normalisedSource = normaliseCompactTags(source);
  const fragment = parseHtmlFragment(
    normalisedSource.replaceAll("{{...props}}", `${propsPlaceholderAttribute}=""`),
    true,
  );

  annotateTagNames(fragment, normalisedSource);

  return fragment;
};

export const findHead = (node: HtmlNode): HtmlNode | undefined => {
  if (node.tagName === "head") return node;

  for (const child of node.childNodes ?? []) {
    const head = findHead(child);

    if (head) return head;
  }
};

export const rewriteCssModuleClasses = (nodes: HtmlNode[], classes: Map<string, string> = new Map()) => {
  for (const node of nodes) {
    const className = node.attrs?.find((attribute) => attribute.name === "class");

    if (className) className.value = className.value.replace(/[^\s]+/g, (name) => classes.get(name) ?? name);

    if (node.childNodes) rewriteCssModuleClasses(node.childNodes, classes);
  }
};

export const attributeValue = (node: HtmlNode, name: string) =>
  node.attrs?.find((attribute) => attribute.name === name)?.value;

export const isHtmlUse = (node: HtmlNode) => node.tagName === "use" && node.namespaceURI === HTML_NAMESPACE;

export const locationFrom = (node: HtmlNode | undefined) => {
  const start = node?.sourceCodeLocation?.startTag;

  return start ? `:${start.startLine}:${start.startCol}` : "";
};

export const sourceTag = (node: HtmlNode | undefined, source: string) => {
  const start = node?.sourceCodeLocation?.startTag;

  return start ? source.slice(start.startOffset, start.endOffset) : `<${node?.rawTagName ?? node?.tagName ?? "use"}>`;
};
