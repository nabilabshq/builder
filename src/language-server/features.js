import { CompletionItemKind, DiagnosticSeverity, InsertTextFormat } from "vscode-languageserver/node.js";

import { resolveSharedDependency } from "../compiler/dependencies.js";
import { NabiError } from "../utils/errors.js";
import {
  attributeValueOffsets,
  attributeValueRange,
  directParentUse,
  elementRange,
  isHtmlElement,
  offsetAt,
  parseHtml,
  rangeAt,
  tagContextAt,
  visitElements,
} from "./html.js";
import { pathFromUri, uriFromPath } from "./project.js";

const preview = (language, source) => `\`\`\`${language}\n${source.trim().slice(0, 1800)}\n\`\`\``;

const componentProps = (metadata) => {
  if (!metadata.props.length) return "";
  const entries = metadata.props.map((name) => {
    const values = metadata.propValues[name];
    return values?.length ? `${name}: ${values.map((value) => `[${value}]`).join(" ")}` : name;
  });
  return `**Component props**  \n${entries.join("  \n")}\n\n---`;
};

const componentItem = (metadata, range) => ({
  label: metadata.name,
  kind: CompletionItemKind.Class,
  detail: "Component",
  documentation: {
    kind: "markdown",
    value: `${componentProps(metadata)}\n\n${preview("html", metadata.component.template)}`,
  },
  insertText: metadata.name,
  ...(range ? { textEdit: { range, newText: metadata.name } } : {}),
});

const sharedItem = ({ value, type, preview: source }) => ({
  label: value,
  kind: CompletionItemKind.File,
  detail: type === "script" ? "Shared script" : "Shared stylesheet",
  documentation: { kind: "markdown", value: preview(type === "script" ? "js" : "css", source) },
  insertText: value,
});

const slotItem = (name) => ({
  label: name,
  kind: CompletionItemKind.Property,
  detail: "Component slot",
  insertText: name,
});
const propValueItem = (value) => ({
  label: value,
  kind: CompletionItemKind.Value,
  detail: "Component prop value",
  insertText: value,
});
const matches = (items, prefix) => items.filter((item) => item.label.startsWith(prefix));
const componentMatches = (items, prefix) =>
  items.filter((item) => item.label.toLowerCase().startsWith(prefix.toLowerCase()));

const triggerSuggest = { title: "Show completion suggestions", command: "editor.action.triggerSuggest" };

const attributeItem = ({ name, detail, documentation, cursor, sortText, preselect = false }) => ({
  label: name,
  sortText,
  preselect,
  kind: CompletionItemKind.Property,
  detail,
  documentation,
  insertTextFormat: InsertTextFormat.Snippet,
  textEdit: { range: cursor.attributeNameRange, newText: `${name}="\${1}"` },
  command: triggerSuggest,
});

const propItem = ({ name, values, cursor }) =>
  attributeItem({
    name,
    detail: values?.length ? `Component prop: ${values.join(" | ")}` : "Component prop",
    documentation: values?.length ? `Allowed values: ${values.join(", ")}.` : undefined,
    cursor,
    sortText: `0_${name}`,
    preselect: true,
  });

const nestedLocalComponent = (component) =>
  component.scope === "local" && component.ref.startsWith("@") && component.ref.split("/").length > 1;
const localComponentRoot = (component) => component.ref.split("/")[0];
const isAvailableComponent = ({ component, owner }) =>
  (!nestedLocalComponent(component) || owner === localComponentRoot(component)) && component.ref !== owner;
const privateComponentMessage = (component) =>
  `Nested local component "${component.ref}" is private to "${localComponentRoot(component)}"`;
const unavailableComponentMessage = ({ component, owner }) =>
  component.ref === owner ? `Component "${component.ref}" cannot reference itself` : privateComponentMessage(component);

const compareComponentMetadata = (left, right) => {
  const priority = Number(nestedLocalComponent(right.component)) - Number(nestedLocalComponent(left.component));
  return priority || left.name.localeCompare(right.name);
};

const completionForComponent = async ({ context, filePath, prefix, range }) => {
  const [metadata, owner] = await Promise.all([
    context.componentMetadata(filePath),
    context.localComponentOwner(filePath),
  ]);
  return componentMatches(
    [...metadata.values()]
      .filter((entry) => isAvailableComponent({ component: entry.component, owner }))
      .sort(compareComponentMetadata)
      .map((entry) => componentItem(entry, range)),
    prefix,
  );
};

const completionForShared = async ({ context, type, prefix }) =>
  matches(
    (await context.sharedPaths(type)).map((entry) => sharedItem({ ...entry, type })),
    prefix,
  );

export const completionsFor = async ({ projects, uri, text, position }) => {
  const cursor = tagContextAt(text, offsetAt(text, position));
  if (!cursor) return [];
  const context = await projects.contextForUri(uri);
  const filePath = pathFromUri(uri);
  if (cursor.tag === "use" && cursor.attribute === "ref")
    return completionForComponent({ context, filePath, prefix: cursor.prefix, range: cursor.range });
  if (cursor.tag === "use" && cursor.attribute && cursor.attributes.has("ref")) {
    const metadata = (await context.componentMetadata(filePath)).get(cursor.attributes.get("ref"));
    return metadata?.propValues[cursor.attribute]
      ? matches(metadata.propValues[cursor.attribute].map(propValueItem), cursor.prefix)
      : [];
  }
  if (cursor.tag === "script" && cursor.attribute === "use")
    return completionForShared({ context, type: "script", prefix: cursor.prefix });
  if (cursor.tag === "link" && cursor.attribute === "use")
    return completionForShared({ context, type: "stylesheet", prefix: cursor.prefix });
  if (cursor.attribute === "slot") {
    const parent = directParentUse(text, cursor.start);
    if (!parent) return [];
    const metadata = (await context.componentMetadata(filePath)).get(parent.attributes.get("ref"));
    return metadata ? matches(metadata.slots.filter((name) => name !== "default").map(slotItem), cursor.prefix) : [];
  }
  if (cursor.tag === "script" && !cursor.attribute && !cursor.attributes.has("use") && !cursor.attributes.has("src"))
    return matches(
      [attributeItem({ name: "use", detail: "Nabi shared script", documentation: "Path from `shared/js`.", cursor })],
      cursor.attributeNamePrefix,
    );
  if (cursor.tag === "link" && !cursor.attribute && !cursor.attributes.has("use") && !cursor.attributes.has("href"))
    return matches(
      [
        attributeItem({
          name: "use",
          detail: "Nabi shared stylesheet",
          documentation: "Path from `shared/styles`.",
          cursor,
        }),
      ],
      cursor.attributeNamePrefix,
    );
  if (cursor.tag !== "use" || cursor.attribute) return [];
  if (!cursor.attributes.has("ref"))
    return matches(
      [
        attributeItem({
          name: "ref",
          detail: "Nabi component reference",
          documentation: "Namespaced global component or page-local `@` component reference.",
          cursor,
        }),
      ],
      cursor.attributeNamePrefix,
    );
  const metadata = (await context.componentMetadata(filePath)).get(cursor.attributes.get("ref"));
  if (!metadata) return [];
  return metadata.props
    .filter((name) => !cursor.attributes.has(name))
    .map((name) => propItem({ name, values: metadata.propValues[name], cursor }));
};

const attributeAt = ({ text, position }) => {
  const offset = offsetAt(text, position);
  let result;
  visitElements(parseHtml(text), (node) => {
    for (const attribute of node.attrs ?? []) {
      const range = attributeValueOffsets({ text, node, attribute });
      if (offset >= range.start && offset <= range.end) result = { node, attribute };
    }
  });
  return result;
};

export const definitionFor = async ({ projects, uri, text, position }) => {
  const found = attributeAt({ text, position });
  if (!found) return [];
  const context = await projects.contextForUri(uri);
  const filePath = pathFromUri(uri);
  if (isHtmlElement(found.node, "use") && found.attribute.name === "ref") {
    try {
      const component = (await context.registryFor(filePath)).get(found.attribute.value);
      const owner = await context.localComponentOwner(filePath);
      if (component && !isAvailableComponent({ component, owner })) return [];
      return component ? [{ uri: uriFromPath(component.path), range: rangeAt("", 0, 0) }] : [];
    } catch {
      return [];
    }
  }
  const type =
    isHtmlElement(found.node, "script") && found.attribute.name === "use"
      ? "script"
      : isHtmlElement(found.node, "link") && found.attribute.name === "use"
        ? "stylesheet"
        : undefined;
  if (!type) return [];
  try {
    const path = await resolveSharedDependency({
      config: context.config,
      value: found.attribute.value,
      type,
      page: filePath,
    });
    return [{ uri: uriFromPath(path), range: rangeAt("", 0, 0) }];
  } catch {
    return [];
  }
};

export const documentLinksFor = async ({ projects, uri, text }) => {
  const context = await projects.contextForUri(uri);
  const filePath = pathFromUri(uri);
  const [registry, owner] = await Promise.all([context.registryFor(filePath), context.localComponentOwner(filePath)]);
  const links = [];
  visitElements(parseHtml(text), (node) => {
    if (!isHtmlElement(node, "use")) return;
    const ref = node.attrs?.find((attribute) => attribute.name === "ref");
    if (!ref) return;
    try {
      const component = registry.get(ref.value);
      if (!component || !isAvailableComponent({ component, owner })) return;
      links.push({ range: attributeValueRange({ text, node, attribute: ref }), target: uriFromPath(component.path) });
    } catch {
      // Diagnostics report invalid refs; they are not links.
    }
  });
  return links;
};

const diagnostic = ({ message, range }) => ({ range, message, severity: DiagnosticSeverity.Error, source: "nabi" });
const readableError = (error) => (error instanceof NabiError ? error.message.split("\n")[0] : error.message);
const hasDefaultSlotContent = (node) =>
  (node.childNodes ?? []).some((child) => {
    const slot = child.attrs?.find((attribute) => attribute.name === "slot");
    if (slot?.value) return false;
    return child.nodeName !== "#text" || child.value?.trim();
  });
const hasSlotContent = (node) =>
  (node.childNodes ?? []).some((child) => child.nodeName !== "#text" || child.value?.trim());
const isSelfClosingUse = ({ text, node }) => {
  const tag = node.sourceCodeLocation?.startTag;
  return tag ? /\/\s*>$/.test(text.slice(tag.startOffset, tag.endOffset)) : false;
};

export const diagnosticsFor = async ({ projects, uri, text }) => {
  let context;
  try {
    context = await projects.contextForUri(uri);
  } catch (error) {
    return [diagnostic({ message: readableError(error), range: rangeAt(text, 0, 0) })];
  }
  const filePath = pathFromUri(uri);
  const diagnostics = [];
  const document = parseHtml(text);
  const registry = await context.registryFor(filePath);
  const owner = await context.localComponentOwner(filePath);
  const componentMetadata = await context.componentMetadata(filePath);
  const checkShared = async ({ node, attribute, type }) => {
    try {
      await resolveSharedDependency({ config: context.config, value: attribute.value, type, page: filePath });
    } catch (error) {
      diagnostics.push(
        diagnostic({ message: readableError(error), range: attributeValueRange({ text, node, attribute }) }),
      );
    }
  };
  const pending = [];
  visitElements(document, (node, parent) => {
    if (isHtmlElement(node, "use")) {
      const ref = node.attrs?.find((attribute) => attribute.name === "ref");
      if (!ref) {
        diagnostics.push(
          diagnostic({ message: 'Missing required attribute "ref"', range: elementRange({ text, node }) }),
        );
      } else {
        try {
          const component = registry.get(ref.value);
          if (!component)
            diagnostics.push(
              diagnostic({
                message: `Component not found: "${ref.value}"`,
                range: attributeValueRange({ text, node, attribute: ref }),
              }),
            );
          else if (!isAvailableComponent({ component, owner }))
            diagnostics.push(
              diagnostic({
                message: unavailableComponentMessage({ component, owner }),
                range: attributeValueRange({ text, node, attribute: ref }),
              }),
            );
          else {
            const metadata = componentMetadata.get(component.ref);
            if (metadata && !metadata.slots.includes("default") && !isSelfClosingUse({ text, node })) {
              const range = elementRange({ text, node });
              if (hasDefaultSlotContent(node))
                diagnostics.push(
                  diagnostic({ message: `Component "${component.ref}" does not define a default slot`, range }),
                );
              else if (!hasSlotContent(node))
                diagnostics.push(
                  diagnostic({
                    message: `Component "${component.ref}" does not define a default slot. Use <use ref="${component.ref}" />.`,
                    range,
                  }),
                );
            }
          }
        } catch (error) {
          diagnostics.push(
            diagnostic({ message: readableError(error), range: attributeValueRange({ text, node, attribute: ref }) }),
          );
        }
      }
    }
    if (isHtmlElement(node, "script")) {
      const use = node.attrs?.find((attribute) => attribute.name === "use");
      if (use) pending.push(checkShared({ node, attribute: use, type: "script" }));
    }
    if (isHtmlElement(node, "link")) {
      const use = node.attrs?.find((attribute) => attribute.name === "use");
      if (use) pending.push(checkShared({ node, attribute: use, type: "stylesheet" }));
    }
    const slot = node.attrs?.find((attribute) => attribute.name === "slot");
    if (!slot || !isHtmlElement(parent ?? {}, "use")) return;
    const parentRef = parent.attrs?.find((attribute) => attribute.name === "ref");
    const component = parentRef ? componentMetadata.get(parentRef.value) : undefined;
    if (component && !component.slots.includes(slot.value))
      diagnostics.push(
        diagnostic({
          message: `Unknown slot "${slot.value}" in component "${component.name}"`,
          range: attributeValueRange({ text, node, attribute: slot }),
        }),
      );
  });
  await Promise.all(pending);
  return diagnostics.sort(
    (left, right) =>
      left.range.start.line - right.range.start.line || left.range.start.character - right.range.start.character,
  );
};
