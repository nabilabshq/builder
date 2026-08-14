import * as parse5 from "parse5";

import { NabiError } from "../utils/errors.js";

const parserOptions = { sourceCodeLocationInfo: true };
const placeholder = /{{([\w:-]+)}}/g;

const annotateTagNames = (node, source) => {
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

const parseDocument = (source) => {
  const document = parse5.parse(source, parserOptions);
  annotateTagNames(document, source);
  return document;
};

const parseFragment = (source) => {
  const fragment = parse5.parseFragment(
    source.replaceAll("{{...props}}", 'data-nabi-props-placeholder=""'),
    parserOptions,
  );
  annotateTagNames(fragment, source);
  return fragment;
};

const findHead = (node) => {
  if (node.tagName === "head") return node;
  for (const child of node.childNodes ?? []) {
    const head = findHead(child);
    if (head) return head;
  }
};

const parseTemplate = (component) => parseFragment(component.template);

const escapeText = (value) => String(value);

const propsFrom = (node) =>
  Object.fromEntries(
    (node.attrs ?? []).map((attribute) => [attribute.name, attribute.value === "" ? "true" : attribute.value]),
  );

const interpolateValue = (value, props) =>
  value.replace(placeholder, (_, key) => (["children", "slot"].includes(key) ? "" : escapeText(props[key] ?? "")));

const cloneNodes = (nodes) =>
  parseFragment(parse5.serialize({ nodeName: "#document-fragment", childNodes: nodes })).childNodes;

const removeAttribute = (node, name) => {
  const index = node.attrs?.findIndex((attribute) => attribute.name === name) ?? -1;
  if (index >= 0) node.attrs.splice(index, 1);
};

const attributeValue = (node, name) => node.attrs?.find((attribute) => attribute.name === name)?.value;

const placeholderKeys = (template) =>
  [...template.matchAll(placeholder)].map(([, key]) => key).filter((key) => !["children", "slot"].includes(key));

const slotName = (node) => attributeValue(node, "slot") || "default";

const templateSlots = (nodes) => {
  const slots = new Set();
  const visit = (node) => {
    if (node.tagName === "slot" && node.namespaceURI === "http://www.w3.org/1999/xhtml")
      slots.add(attributeValue(node, "name") || "default");
    for (const child of node.childNodes ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return slots;
};

const hasMeaningfulContent = (nodes) => nodes.some((node) => node.nodeName !== "#text" || node.value.trim());

const slotChildren = (children) => {
  const slots = new Map([["default", []]]);
  for (const child of children) {
    const name = slotName(child);
    if (!slots.has(name)) slots.set(name, []);
    if (attributeValue(child, "slot") !== undefined) removeAttribute(child, "slot");
    slots.get(name).push(child);
  }
  return slots;
};

const processTemplate = (nodes, props, slots, forwardedProps) => {
  const output = [];
  for (const node of nodes) {
    if (node.nodeName === "#text") {
      const parts = node.value.split(/({{(?:children|slot)}})/g);
      for (const part of parts) {
        if (["{{children}}", "{{slot}}"].includes(part)) output.push(...cloneNodes(slots.get("default") ?? []));
        else if (part) output.push({ ...node, value: interpolateValue(part, props) });
      }
      continue;
    }
    if (node.tagName === "slot" && node.namespaceURI === "http://www.w3.org/1999/xhtml") {
      const name = attributeValue(node, "name") || "default";
      const assigned = slots.get(name) ?? [];
      output.push(
        ...(assigned.length
          ? cloneNodes(assigned)
          : processTemplate(cloneNodes(node.childNodes ?? []), props, slots, forwardedProps)),
      );
      continue;
    }
    if (node.attrs) {
      const attributes = [];
      for (const attribute of node.attrs) {
        if (attribute.name === "data-nabi-props-placeholder")
          attributes.push(...forwardedProps.map((item) => ({ ...item })));
        else attributes.push({ ...attribute, value: interpolateValue(attribute.value, props) });
      }
      node.attrs = attributes;
    }
    if (node.childNodes) node.childNodes = processTemplate(node.childNodes, props, slots, forwardedProps);
    output.push(node);
  }
  return output;
};

const locationFrom = (node) => {
  const start = node?.sourceCodeLocation?.startTag;
  return start ? `:${start.startLine}:${start.startCol}` : "";
};

const sourceTag = (node, source) => {
  const start = node?.sourceCodeLocation?.startTag;
  return start ? source.slice(start.startOffset, start.endOffset) : `<${node?.rawTagName ?? node?.tagName ?? "use"}>`;
};

const componentError = (message, context, node) =>
  new NabiError(`Component compilation failed\n\nFile: ${context.page}${locationFrom(node)}\n\n${message}`);

const slotError = ({ component, state, message }) =>
  componentError(`${message}\n\nComponent:\n${component.path}`, state);

const validateSlots = ({ component, slots, template, state }) => {
  const available = templateSlots(template.childNodes);
  for (const [name, nodes] of slots) {
    if (!hasMeaningfulContent(nodes) || available.has(name)) continue;
    if (name === "default")
      throw slotError({ component, state, message: `Component "${component.ref}" does not define a default slot` });
    const list = [...available].map((slot) => `- ${slot}`).join("\n") || "- none";
    throw slotError({
      component,
      state,
      message: `Unknown slot "${name}" in component "${component.ref}"\n\nAvailable slots:\n${list}`,
    });
  }
};

const isHtmlUse = (node) => node.tagName === "use" && node.namespaceURI === "http://www.w3.org/1999/xhtml";

const compileNodes = (nodes, state) => {
  const result = [];
  for (const node of nodes) {
    if (!node.tagName) {
      if (node.childNodes) node.childNodes = compileNodes(node.childNodes, state);
      result.push(node);
      continue;
    }
    if (!isHtmlUse(node)) {
      if (node.childNodes) node.childNodes = compileNodes(node.childNodes, state);
      result.push(node);
      continue;
    }
    const ref = attributeValue(node, "ref");
    if (ref === undefined) {
      throw componentError(
        `Invalid component invocation: required attribute "ref" is missing\n\nFound:\n${sourceTag(node, state.source)}\n\nExpected:\n<use ref="button">Button text</use>`,
        state,
        node,
      );
    }
    const component = state.registry.get(ref);
    if (!component)
      throw componentError(
        `Component not found: "${ref}"\n\nExpected:\n${state.registry.expectedPath(ref)}`,
        state,
        node,
      );
    if (state.stack.includes(component.ref)) {
      const chain = [...state.stack, component.ref].join(" → ");
      throw componentError(`Circular component dependency:\n\n${chain}`, state, node);
    }
    state.onComponentResolved?.(component);
    const projectedSlots = slotChildren(node.childNodes ?? []);
    const template = parseTemplate(component);
    validateSlots({ component, slots: projectedSlots, template, state });
    for (const [name, children] of projectedSlots) projectedSlots.set(name, compileNodes(children, state));
    const props = propsFrom(node);
    delete props.ref;
    const consumedProps = new Set([...placeholderKeys(component.template), ...component.props]);
    const forwardedProps = (node.attrs ?? []).filter(
      (attribute) => !consumedProps.has(attribute.name) && !["ref", "slot"].includes(attribute.name),
    );
    const interpolated = processTemplate(template.childNodes, props, projectedSlots, forwardedProps);
    const compiled = compileNodes(interpolated, { ...state, stack: [...state.stack, component.ref] });
    if (component.isHeadTemplate) state.headNodes.push(...compiled);
    else result.push(...compiled);
  }
  return result;
};

export const compilePage = async ({ source, registry, page = "page.html", onComponentResolved }) => {
  const document = parseDocument(source);
  const head = findHead(document);
  const state = { registry, page, source, stack: [], onComponentResolved, headNodes: [] };
  document.childNodes = compileNodes(document.childNodes, state);
  if (head && state.headNodes.length) head.childNodes.push(...state.headNodes);
  return parse5.serialize(document);
};
