import type { Component } from "@/types";
import type { HtmlAttribute, HtmlNode } from "@/utils/html";
import { HTML_NAMESPACE, serializeHtml } from "@/utils/html";

import {
  attributeValue,
  compactUseAttribute,
  parseFragment,
  propsPlaceholderAttribute,
  reservedPlaceholders,
} from "./shared";

type ProcessTemplate = {
  forwardedProps: HtmlAttribute[];
  nodes: HtmlNode[];
  props: Record<string, string>;
  slots: Map<string, HtmlNode[]>;
};

const PALCEHOLDER = /{{([\w:-]+)}}/g;

export const parseTemplate = (component: Component) => parseFragment(component.template);

const stringify = (value: unknown) => String(value);
const interpolateValue = (value: string, props: Record<string, string>) =>
  value.replace(PALCEHOLDER, (_match, key: string) =>
    reservedPlaceholders.has(key) ? "" : stringify(props[key] ?? ""),
  );
const cloneNodes = (nodes: HtmlNode[]) =>
  parseFragment(serializeHtml({ childNodes: nodes, nodeName: "#document-fragment" })).childNodes;

export const propsFrom = (node: HtmlNode) =>
  Object.fromEntries(
    (node.attrs ?? [])
      .filter((attribute) => attribute.name !== compactUseAttribute)
      .map((attribute) => [attribute.name, attribute.value === "" ? "true" : attribute.value]),
  );

export const placeholderKeys = (template: string) =>
  [...template.matchAll(PALCEHOLDER)].map(([, key]) => key).filter((key) => !reservedPlaceholders.has(key));

export const processTemplate = ({ forwardedProps, nodes, props, slots }: ProcessTemplate) => {
  const output: HtmlNode[] = [];

  for (const node of nodes) {
    if (node.nodeName === "#text") {
      const parts = (node.value ?? "").split(/({{(?:children|slot)}})/g);

      for (const part of parts) {
        if (part === "{{children}}" || part === "{{slot}}") {
          output.push(...cloneNodes(slots.get("default") ?? []));
        } else if (part) {
          output.push({ ...node, value: interpolateValue(part, props) });
        }
      }

      continue;
    }

    if (node.tagName === "slot" && node.namespaceURI === HTML_NAMESPACE) {
      const name = attributeValue(node, "name") || "default";
      const assigned = slots.get(name) ?? [];

      output.push(
        ...(assigned.length
          ? cloneNodes(assigned)
          : processTemplate({
              forwardedProps,
              nodes: cloneNodes(node.childNodes ?? []),
              props,
              slots,
            })),
      );

      continue;
    }

    if (node.attrs) {
      const attributes = [];

      for (const attribute of node.attrs) {
        if (attribute.name === propsPlaceholderAttribute) {
          attributes.push(...forwardedProps.map((item) => ({ ...item })));
        } else {
          attributes.push({
            ...attribute,
            value: interpolateValue(attribute.value, props),
          });
        }
      }

      node.attrs = attributes;
    }

    if (node.childNodes) {
      node.childNodes = processTemplate({
        forwardedProps,
        nodes: node.childNodes,
        props,
        slots,
      });
    }

    output.push(node);
  }

  return output;
};
