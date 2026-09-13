import type { HtmlNode } from "@/utils/html";
import { HTML_NAMESPACE } from "@/utils/html";

import { componentError } from "./errors";
import { attributeValue } from "./shared";
import type { CompilationState } from "./types";

type ConditionalChildrenProps = {
  node: HtmlNode;
  state: CompilationState;
};

const unresolvedRouteValue = /^{{:[\w.-]+}}$/;

const isHtmlElement = (node: HtmlNode, name: string) => {
  return node.namespaceURI === HTML_NAMESPACE && node.tagName === name;
};

const isHtmlIf = (node: HtmlNode) => isHtmlElement(node, "if");

const conditionFor = ({ node, state }: ConditionalChildrenProps) => {
  const attributes = node.attrs ?? [];
  const when = attributeValue(node, "when");

  if (when === undefined) {
    throw componentError('<if> requires a "when" attribute.', state, node);
  }

  if (attributes.some((attribute) => attribute.name !== "when")) {
    throw componentError('<if> only accepts the "when" attribute.', state, node);
  }

  if (when === "true") return true;

  if (when === "false" || when === "" || unresolvedRouteValue.test(when)) {
    return false;
  }

  throw componentError('<if> "when" must resolve to "true" or "false".', state, node);
};

export const isHtmlElse = (node: HtmlNode) => isHtmlElement(node, "else");

export const conditionalChildren = (props: ConditionalChildrenProps): HtmlNode[] | undefined => {
  const { node, state } = props;

  if (!isHtmlIf(node)) return;

  const children = node.childNodes ?? [];
  const elseNodes = children.filter(isHtmlElse);

  if (elseNodes.length > 1) {
    throw componentError("<if> cannot contain more than one direct <else> child.", state, node);
  }

  const elseNode = elseNodes[0];

  if (elseNode?.attrs?.length) {
    throw componentError("<else> does not accept attributes.", state, elseNode);
  }

  if (!conditionFor(props)) {
    return elseNode?.childNodes ?? [];
  }

  return elseNode ? children.slice(0, children.indexOf(elseNode)) : children;
};
