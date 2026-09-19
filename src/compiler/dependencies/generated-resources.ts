import type { HtmlAttribute, HtmlNode } from "@/utils/html";
import { HTML_NAMESPACE, parseDocument, serializeHtml } from "@/utils/html";

type InjectGeneratedResourcesProps = {
  css?: string[];
  cssSources?: string[];
  html: string;
  inline?: boolean;
  js?: string[];
  jsSources?: string[];
};

const findElement = (node: HtmlNode, tagName: string): HtmlNode | undefined => {
  if (node.tagName === tagName) return node;

  for (const child of node.childNodes ?? []) {
    const found = findElement(child, tagName);

    if (found) return found;
  }
};

const element = (tagName: string, attrs: HtmlAttribute[] = [], childNodes: HtmlNode[] = []): HtmlNode => ({
  attrs,
  childNodes,
  namespaceURI: HTML_NAMESPACE,
  nodeName: tagName,
  tagName,
});

export const injectGeneratedResources = (props: InjectGeneratedResourcesProps) => {
  const { css = [], cssSources = [], html, inline = false, js = [], jsSources = [] } = props;

  const document = parseDocument(html);
  const rawBlocks: { marker: string; value: string }[] = [];

  const rawBlock = (value: string) => {
    let marker = `__NABI_GENERATED_${rawBlocks.length}__`;

    while (html.includes(marker)) {
      marker = `_${marker}_`;
    }

    rawBlocks.push({ marker, value });

    return marker;
  };

  const head = findElement(document, "head");
  const body = findElement(document, "body");

  if (head && css.length) {
    (head.childNodes ??= []).push(
      ...(inline
        ? css.map((value, index) =>
            element("style", cssSources[index] ? [{ name: "data-href", value: cssSources[index] }] : [], [
              { nodeName: "#text", value: rawBlock(value.replace(/<\/style/gi, "<\\/style")) },
            ]),
          )
        : css.map((path) =>
            element("link", [
              { name: "rel", value: "stylesheet" },
              { name: "href", value: path },
            ]),
          )),
    );
  }

  if (body && js.length) {
    (body.childNodes ??= []).push(
      ...(inline
        ? js.map((value, index) =>
            element("script", jsSources[index] ? [{ name: "data-src", value: jsSources[index] }] : [], [
              { nodeName: "#text", value: rawBlock(value.replace(/<\/script/gi, "<\\/script")) },
            ]),
          )
        : js.map((path) => element("script", [{ name: "src", value: path }]))),
    );
  }

  return rawBlocks.reduce((output, { marker, value }) => output.replace(marker, value), serializeHtml(document));
};
