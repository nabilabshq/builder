import type { Component } from "@/types";
import type { HtmlDocument, HtmlNode } from "@/utils/html";
import { HTML_NAMESPACE } from "@/utils/html";

import { slotError } from "./errors";
import { attributeValue } from "./shared";
import type { CompilationState } from "./types";

type ValidateSlots = {
  component: Component;
  isSelfClosing: boolean;
  slots: Map<string, HtmlNode[]>;
  state: CompilationState;
  template: HtmlDocument;
};

const hasMeaningfulContent = (nodes: HtmlNode[]) =>
  nodes.some((node) => node.nodeName !== "#text" || Boolean(node.value?.trim()));

const slotName = (node: HtmlNode) => attributeValue(node, "slot") || "default";

const removeAttribute = (node: HtmlNode, name: string) => {
  const index = node.attrs?.findIndex((attribute) => attribute.name === name) ?? -1;

  if (index >= 0) node.attrs?.splice(index, 1);
};

const templateSlots = (nodes: HtmlNode[]) => {
  const slots = new Set<string>();

  const visit = (node: HtmlNode) => {
    if (node.tagName === "slot" && node.namespaceURI === HTML_NAMESPACE) {
      slots.add(attributeValue(node, "name") || "default");
    }

    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return slots;
};

export const extractSlots = (children: HtmlNode[]) => {
  const slots = new Map<string, HtmlNode[]>([["default", []]]);

  for (const child of children) {
    const name = slotName(child);

    removeAttribute(child, "slot");

    const slot = slots.get(name);

    if (slot) {
      slot.push(child);
    } else {
      slots.set(name, [child]);
    }
  }

  return slots;
};

export const validateSlots = (props: ValidateSlots) => {
  const { component, isSelfClosing, slots, state, template } = props;

  const available = templateSlots(template.childNodes);
  const hasProjectedContent = [...slots.values()].some(hasMeaningfulContent);

  if (!isSelfClosing && !available.has("default") && !hasProjectedContent) {
    throw slotError({
      component,
      message: `Component "${component.ref}" does not define a default slot. Use <use ref="${component.ref}" />.`,
      state,
    });
  }

  for (const [name, nodes] of slots) {
    if (!hasMeaningfulContent(nodes) || available.has(name)) continue;

    if (name === "default") {
      throw slotError({
        component,
        message: `Component "${component.ref}" does not define a default slot`,
        state,
      });
    }

    const list = [...available].map((slot) => `- ${slot}`).join("\n") || "- none";

    throw slotError({
      component,
      message: `Unknown slot "${name}" in component "${component.ref}"\n\nAvailable slots:\n${list}`,
      state,
    });
  }
};
