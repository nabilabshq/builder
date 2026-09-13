import { basename } from "node:path";

import type { CompletionItem, Position, Range } from "vscode-languageserver/node.js";
import { CompletionItemKind, InsertTextFormat } from "vscode-languageserver/node.js";

import type { TagCursor } from "../html";
import { directParentUse, offsetAt, rangeAt, tagContextAt } from "../html";
import type { ComponentMetadata, DependencyType, ProjectContext, ProjectManager } from "../project";
import { pathFromUri } from "../project";
import { isRouteDataPathCompletion, isRouteValueCompletion, routeDataCompletionsFor } from "./route-data.ts";
import { isAvailableComponent, nestedLocalComponent, sharedElements } from "./shared";

type CompletionContext = {
  context: ProjectContext;
  filePath: string;
  prefix: string;
  range?: Range;
};

type SharedItem = {
  preview: string;
  type: DependencyType;
  value: string;
};

type AttributeItem = {
  cursor: TagCursor;
  detail: string;
  documentation?: string;
  name: string;
  preselect?: boolean;
  sortText?: string;
};

type PropItem = {
  cursor: TagCursor;
  name: string;
  values?: string[];
};

type InterpolationPrefix = { prefix: string; start: number };

type InterpolationItemProps = {
  hasChildren: boolean;
  path: string;
  position: Position;
  prefix: InterpolationPrefix;
  text: string;
};

type CompletionForShared = {
  context: ProjectContext;
  prefix: string;
  type: DependencyType;
};

type CompletionFor = {
  position: Position;
  projects: ProjectManager;
  text: string;
  uri: string;
};

const preview = (language: string, source: string) => `\`\`\`${language}\n${source.trim().slice(0, 1800)}\n\`\`\``;

const componentProps = (metadata: ComponentMetadata) => {
  if (!metadata.props.length) return "";

  const entries = metadata.props.map((name) => {
    const values = metadata.propValues[name];

    return values?.length ? `${name}: ${values.map((value) => `[${value}]`).join(" ")}` : name;
  });

  return `**Component props**  \n${entries.join("  \n")}\n\n---`;
};

const componentItem = (metadata: ComponentMetadata, range?: Range): CompletionItem => ({
  detail: "Component",
  documentation: {
    kind: "markdown",
    value: `${componentProps(metadata)}\n\n${preview("html", metadata.component.template)}`,
  },
  insertText: metadata.name,
  kind: CompletionItemKind.Class,
  label: metadata.name,
  ...(range ? { textEdit: { newText: metadata.name, range } } : {}),
});

const sharedItem = ({ preview: source, type, value }: SharedItem): CompletionItem => ({
  detail: type === "script" ? "Shared script" : "Shared stylesheet",
  documentation: { kind: "markdown", value: preview(type === "script" ? "js" : "css", source) },
  insertText: value,
  kind: CompletionItemKind.File,
  label: value,
});

const slotItem = (name: string): CompletionItem => ({
  detail: "Component slot",
  insertText: name,
  kind: CompletionItemKind.Property,
  label: name,
});

const propValueItem = (value: string): CompletionItem => ({
  detail: "Component prop value",
  insertText: value,
  kind: CompletionItemKind.Value,
  label: value,
});

const interpolationPrefixAt = ({ position, text }: Omit<CompletionFor, "projects" | "uri">) => {
  const offset = offsetAt(text, position);
  const match = /{{:([\w.-]*)$/.exec(text.slice(0, offset));

  if (!match) return;

  const prefix = match[1]!;

  return {
    prefix,
    start: offset - prefix.length,
  };
};

const interpolationItem = (props: InterpolationItemProps): CompletionItem => {
  const { hasChildren, path, position, prefix, text } = props;

  const offset = offsetAt(text, position);

  return {
    ...(hasChildren ? { command: triggerSuggest } : {}),
    detail: hasChildren ? "Dynamic route object" : "Dynamic route value",
    documentation: hasChildren
      ? "Object from the current dynamic route data. Type a dot to select a nested value."
      : "Value from the current dynamic route data.",
    kind: hasChildren ? CompletionItemKind.Struct : CompletionItemKind.Value,
    label: path,
    preselect: true,
    sortText: `${hasChildren ? 1 : 0}_${path}`,
    textEdit: {
      newText: hasChildren ? `${path}.` : path,
      range: rangeAt(text, prefix.start, offset),
    },
  };
};

const interpolationDepth = (path: string) => path.split(".").length;

const interpolationMatches = (paths: string[], prefix: string) => {
  const maximumDepth = prefix ? interpolationDepth(prefix) : 1;

  return paths.filter((path) => path.startsWith(prefix) && interpolationDepth(path) <= maximumDepth);
};

const labelOf = (item: CompletionItem) => String(item.label);

const matches = (items: CompletionItem[], prefix: string) => {
  return items.filter((item) => labelOf(item).startsWith(prefix));
};

const componentMatches = (items: CompletionItem[], prefix: string) => {
  return items.filter((item) => labelOf(item).toLowerCase().startsWith(prefix.toLowerCase()));
};

const triggerSuggest = {
  command: "editor.action.triggerSuggest",
  title: "Show completion suggestions",
};

const attributeItem = (props: AttributeItem): CompletionItem => {
  const { cursor, detail, documentation, name, preselect = false, sortText = `1_${name}` } = props;

  return {
    command: triggerSuggest,
    detail,
    documentation,
    insertTextFormat: InsertTextFormat.Snippet,
    kind: CompletionItemKind.Property,
    label: name,
    preselect,
    sortText,
    textEdit: {
      newText: `${name}="\${1}"`,
      range: cursor.attributeNameRange ?? rangeAt("", 0, 0),
    },
  };
};

const propItem = ({ cursor, name, values }: PropItem) =>
  attributeItem({
    cursor,
    detail: values?.length ? `Component prop: ${values.join(" | ")}` : "Component prop",
    documentation: values?.length ? `Allowed values: ${values.join(", ")}.` : undefined,
    name,
    preselect: true,
    sortText: `0_${name}`,
  });

const compareComponentMetadata = (left: ComponentMetadata, right: ComponentMetadata) => {
  const priority = Number(nestedLocalComponent(right.component)) - Number(nestedLocalComponent(left.component));

  return priority || left.name.localeCompare(right.name);
};

const completionForComponent = async (props: CompletionContext) => {
  const { context, filePath, prefix, range } = props;

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

const completionForShared = async ({ context, prefix, type }: CompletionForShared) => {
  const paths = await context.sharedPaths(type);
  const items = paths.map((entry) => sharedItem({ ...entry, type }));

  return matches(items, prefix);
};

export const completionsFor = async ({ position, projects, text, uri }: CompletionFor) => {
  const context = await projects.contextForUri(uri);
  const filePath = pathFromUri(uri);

  if (basename(filePath) === `${context.config.routeFileName}.json`) {
    const completionContext = { position, text };

    const [dataPaths, parentParameters, parentRecords] = await Promise.all([
      isRouteDataPathCompletion(completionContext) ? context.routeDataPaths() : [],
      context.parentRouteParameters(filePath),
      isRouteValueCompletion(completionContext) ? context.parentRouteRecords(filePath).catch(() => ({})) : {},
    ]);

    return routeDataCompletionsFor({
      dataPaths,
      parentParameters,
      parentRecords,
      position,
      text,
    });
  }

  const interpolationPrefix = interpolationPrefixAt({ position, text });

  if (interpolationPrefix) {
    const { paths } = await context.routeInterpolation(filePath).catch(() => ({ paths: [] }));
    const hasChildren = (path: string) => paths.some((candidate) => candidate.startsWith(`${path}.`));
    const sort = (a: string, b: string) => Number(hasChildren(a)) - Number(hasChildren(b)) || a.localeCompare(b);

    return interpolationMatches(paths, interpolationPrefix.prefix)
      .sort(sort)
      .map((path) => {
        const nested = hasChildren(path);

        return interpolationItem({
          hasChildren: nested,
          path,
          position,
          prefix: interpolationPrefix,
          text,
        });
      });
  }

  const cursor = tagContextAt(text, offsetAt(text, position));

  if (!cursor) return [];

  if (cursor.tag === "use" && cursor.attribute === "ref") {
    return completionForComponent({
      context,
      filePath,
      prefix: cursor.prefix ?? "",
      range: cursor.range,
    });
  }

  if (cursor.tag === "use" && cursor.attribute && cursor.attributes.has("ref")) {
    const ref = cursor.attributes.get("ref");
    const metadata = ref ? (await context.componentMetadata(filePath)).get(ref) : undefined;

    return metadata?.propValues[cursor.attribute]
      ? matches(metadata.propValues[cursor.attribute].map(propValueItem), cursor.prefix ?? "")
      : [];
  }

  const sharedType = cursor.attribute === "use" ? sharedElements.find(([tag]) => tag === cursor.tag)?.[1] : undefined;

  if (sharedType) {
    return completionForShared({ context, prefix: cursor.prefix ?? "", type: sharedType });
  }

  if (cursor.attribute === "slot") {
    const parent = directParentUse(text, cursor.start);

    if (!parent) return [];

    const ref = parent.attributes.get("ref");
    const metadata = ref ? (await context.componentMetadata(filePath)).get(ref) : undefined;

    return metadata
      ? matches(metadata.slots.filter((name) => name !== "default").map(slotItem), cursor.prefix ?? "")
      : [];
  }

  if (cursor.tag === "script" && !cursor.attribute && !cursor.attributes.has("use") && !cursor.attributes.has("src")) {
    return matches(
      [
        attributeItem({
          cursor,
          detail: "Nabi shared script",
          documentation: "Path from `shared/js`.",
          name: "use",
        }),
      ],
      cursor.attributeNamePrefix ?? "",
    );
  }

  if (cursor.tag === "link" && !cursor.attribute && !cursor.attributes.has("use") && !cursor.attributes.has("href")) {
    return matches(
      [
        attributeItem({
          cursor,
          detail: "Nabi shared stylesheet",
          documentation: "Path from `shared/styles`.",
          name: "use",
        }),
      ],
      cursor.attributeNamePrefix ?? "",
    );
  }

  if (cursor.tag !== "use" || cursor.attribute) return [];

  if (!cursor.attributes.has("ref")) {
    return matches(
      [
        attributeItem({
          cursor,
          detail: "Nabi component reference",
          documentation: "Namespaced global component or page-local `@` component reference.",
          name: "ref",
        }),
      ],
      cursor.attributeNamePrefix ?? "",
    );
  }

  const ref = cursor.attributes.get("ref");
  const metadata = ref ? (await context.componentMetadata(filePath)).get(ref) : undefined;

  if (!metadata) return [];

  return metadata.props
    .filter((name) => !cursor.attributes.has(name))
    .map((name) => propItem({ cursor, name, values: metadata.propValues[name] }));
};
