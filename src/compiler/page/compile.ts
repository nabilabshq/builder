import type { Component } from "@/types";
import type { HtmlNode } from "@/utils/html";
import { serializeHtml } from "@/utils/html";

import { conditionalChildren, isDeferredRouteCondition, isHtmlElse } from "./conditional";
import { componentError } from "./errors";
import {
  attributeValue,
  compactUseAttribute,
  findHead,
  internalUseAttributes,
  isHtmlUse,
  normaliseCompactTags,
  parseDocument,
  rewriteCssModuleClasses,
  sourceTag,
} from "./shared";
import { extractSlots, validateSlots } from "./slots";
import { parseTemplate, placeholderKeys, processTemplate, propsFrom } from "./template";
import type { CompilationState, CompilePageOptions } from "./types";

type ResolveComponent = {
  node: HtmlNode;
  ref: string;
  state: CompilationState;
};

type CompilationStateProps = {
  component: Component;
  state: CompilationState;
};

const resolveComponent = ({ node, ref, state }: ResolveComponent) => {
  let component: Component | undefined;

  try {
    component = state.registry.get(ref);
  } catch (error) {
    throw componentError(error instanceof Error ? error.message : String(error), state, node);
  }

  if (!component) {
    throw componentError(
      `Component not found: "${ref}"\n\nExpected:\n${state.registry.expectedPath(ref)}`,
      state,
      node,
    );
  }

  return component;
};

const componentState = ({ component, state }: CompilationStateProps): CompilationState => ({
  ...state,
  owner: component.ref,
  page: component.path,
  source: component.template,
  stack: [...state.stack, component.ref],
});

const compileUse = (node: HtmlNode, state: CompilationState) => {
  const ref = attributeValue(node, "ref");

  if (ref === undefined) {
    throw componentError(
      `Invalid component invocation: required attribute "ref" is missing\n\nFound:\n${sourceTag(node, state.source)}\n\nExpected:\n<use ref="ui/button">Button text</use>`,
      state,
      node,
    );
  }

  const component = resolveComponent({ node, ref, state });
  const [rootRef, ...nestedSegments] = component.ref.split("/");

  if (component.scope === "local" && nestedSegments.length > 0 && state.owner !== rootRef) {
    throw componentError(
      `Nested local component "${component.ref}" is private to "${rootRef}"\n\nUse it only inside ${rootRef}/index.html.`,
      state,
      node,
    );
  }

  if (state.stack.includes(component.ref)) {
    const chain = [...state.stack, component.ref].join(" -> ");

    throw componentError(`Circular component dependency:\n\n${chain}`, state, node);
  }

  state.onComponentResolved?.(component);

  const isSelfClosing = attributeValue(node, compactUseAttribute) !== undefined;
  const projectedSlots = extractSlots(node.childNodes ?? []);
  const template = parseTemplate(component);

  rewriteCssModuleClasses(template.childNodes, component.cssModuleClasses);
  validateSlots({ component, isSelfClosing, slots: projectedSlots, state, template });

  for (const [name, children] of projectedSlots) {
    projectedSlots.set(name, compileNodes(children, state));
  }

  const props = propsFrom(node);

  delete props.ref;

  const consumedProps = new Set([...placeholderKeys(component.template), ...component.props]);
  const forwardedProps = (node.attrs ?? []).filter(
    (attribute) => !consumedProps.has(attribute.name) && !internalUseAttributes.has(attribute.name),
  );

  const compiled = compileNodes(
    processTemplate({
      forwardedProps,
      nodes: template.childNodes,
      props,
      slots: projectedSlots,
    }),
    componentState({
      component,
      state,
    }),
  );

  if (component.isHeadTemplate) {
    state.headNodes.push(...compiled);

    return [];
  }

  return compiled;
};

const compileNodes = (nodes: HtmlNode[], state: CompilationState) => {
  const result: HtmlNode[] = [];

  for (const node of nodes) {
    if (isDeferredRouteCondition({ node, state })) {
      state.onDeferredRouteCondition?.();
      result.push(node);
      continue;
    }

    if (isHtmlElse(node)) {
      throw componentError("<else> must be a direct child of <if>.", state, node);
    }

    const selected = conditionalChildren({ node, state });

    if (selected) {
      result.push(...compileNodes(selected, state));
      continue;
    }

    if (isHtmlUse(node)) {
      result.push(...compileUse(node, state));
      continue;
    }

    if (node.childNodes) {
      node.childNodes = compileNodes(node.childNodes, state);
    }

    result.push(node);
  }

  return result;
};

export const compilePage = async (props: CompilePageOptions) => {
  const {
    cssModuleClasses = new Map(),
    deferRouteConditions = false,
    onComponentResolved,
    onDeferredRouteCondition,
    page = "page.html",
    registry,
    source,
  } = props;

  const normalisedSource = normaliseCompactTags(source);
  const document = parseDocument(normalisedSource);

  rewriteCssModuleClasses(document.childNodes, cssModuleClasses);

  const head = findHead(document);
  const state: CompilationState = {
    deferRouteConditions,
    headNodes: [],
    onComponentResolved,
    onDeferredRouteCondition,
    owner: undefined,
    page,
    registry,
    source: normalisedSource,
    stack: [],
  };

  document.childNodes = compileNodes(document.childNodes, state);

  if (head && state.headNodes.length) {
    (head.childNodes ??= []).push(...state.headNodes);
  }

  return serializeHtml(document);
};
