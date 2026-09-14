import type { NabiConfig } from "@/types";
import type { HtmlNode } from "@/utils/html";
import { parseDocument, serializeHtml } from "@/utils/html";

import { sourcePathFromProject } from "../resources";

type BodyOutputProps = { config: NabiConfig; html: string };

const findElement = (node: HtmlNode, tagName: string): HtmlNode | undefined => {
  if (node.tagName === tagName) return node;

  for (const child of node.childNodes ?? []) {
    const found = findElement(child, tagName);

    if (found) return found;
  }
};

const attribute = (node: HtmlNode, name: string) => node.attrs?.find((item) => item.name === name);

const extractElements = (node: HtmlNode, tagName: string, predicate: (node: HtmlNode) => boolean = () => true) => {
  const elements: HtmlNode[] = [];

  const visit = (current: HtmlNode) => {
    const children: HtmlNode[] = [];

    for (const child of current.childNodes ?? []) {
      if (child.tagName === tagName && predicate(child)) {
        elements.push(child);
        continue;
      }

      visit(child);
      children.push(child);
    }

    current.childNodes = children;
  };

  visit(node);

  return elements;
};

export const bodyOutput = (props: BodyOutputProps) => {
  const { config, html } = props;

  const document = parseDocument(html);
  const body = findElement(document, "body");

  const styles = extractElements(document, "style");
  const scripts = extractElements(document, "script").filter(
    (script) => attribute(script, "type")?.value === "application/json",
  );

  const globalStylePath = `${sourcePathFromProject({ config, path: config.stylesPath })}/`;
  const globalStyles: HtmlNode[] = [];

  const componentStyles: HtmlNode[] = [];

  for (const style of styles) {
    if (attribute(style, "data-href")?.value.startsWith(globalStylePath)) {
      globalStyles.push(style);
    } else {
      componentStyles.push(style);
    }
  }

  return serializeHtml({
    childNodes: [...globalStyles, ...componentStyles, ...(body?.childNodes ?? []), ...scripts],
    nodeName: "#document-fragment",
  });
};
