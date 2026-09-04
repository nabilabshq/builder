import type { CompletionItem, Position } from "vscode-languageserver/node.js";
import { CompletionItemKind, InsertTextFormat } from "vscode-languageserver/node.js";

import type { ParsedRouteRecord } from "@/routing/dynamic/types";

import { offsetAt, rangeAt } from "../html.ts";

type RouteDataFile = { preview: string; value: string };

type RouteDataCompletionProps = {
  dataPaths: RouteDataFile[];
  parentParameters: string[];
  parentRecords?: Record<string, ParsedRouteRecord[]>;
  position: Position;
  text: string;
};

type RouteDataItemProps = {
  command?: CompletionItem["command"];
  documentation: string;
  insertText: string;
  label: string;
  position: Position;
  text: string;
};

type PropertyPrefix = { objectStart: number; prefix: string; start: number };
type PropertyPrefixAt = Omit<RouteDataCompletionProps, "dataPaths" | "parentParameters" | "parentRecords">;

type DataPathPrefix = { needsQuotes?: boolean; prefix: string; start: number };
type DataPathPrefixAt = Omit<RouteDataCompletionProps, "dataPaths" | "parentParameters" | "parentRecords">;
type ValuePrefix = {
  key: string;
  needsQuotes?: boolean;
  objectStart: number;
  prefix: string;
  selected: string[];
  start: number;
};
type ValuePrefixAt = Omit<RouteDataCompletionProps, "dataPaths" | "parentParameters" | "parentRecords">;

type RouteValueItem = {
  needsQuotes?: boolean;
  position: Position;
  text: string;
  value: string;
};

type RouteConditionItemProps = {
  name: string;
  position: Position;
  property: PropertyPrefix;
  text: string;
};

type RouteDataPathItemProps = {
  position: Position;
  prefix: DataPathPrefix;
  source: RouteDataFile;
  text: string;
};

type JsonContainer = { kind: "array" | "object"; start: number };

type JsonStringState = {
  escaped: boolean;
  quote: boolean;
};

const isJsonStringCharacter = (state: JsonStringState, character: string) => {
  if (!state.quote) {
    if (character === '"') {
      state.quote = true;
    }

    return state.quote;
  }

  if (state.escaped) {
    state.escaped = false;
  } else if (character === "\\") {
    state.escaped = true;
  } else if (character === '"') {
    state.quote = false;
  }

  return true;
};

const containersAt = (source: string) => {
  const stack: JsonContainer[] = [];
  const stringState: JsonStringState = { escaped: false, quote: false };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;

    if (isJsonStringCharacter(stringState, character)) {
      continue;
    }

    if (character === "{") {
      stack.push({ kind: "object", start: index });
    } else if (character === "[") {
      stack.push({ kind: "array", start: index });
    } else if (character === "}" || character === "]") {
      stack.pop();
    }
  }

  return stack;
};

const objectStartAt = (source: string) => {
  const containers = containersAt(source);

  for (let index = containers.length - 1; index >= 0; index -= 1) {
    const container = containers[index]!;

    if (container.kind === "object") {
      return container.start;
    }
  }
};

const currentContainerAt = (source: string) => {
  return containersAt(source).at(-1);
};

const objectEndAt = (source: string, start: number) => {
  const stringState: JsonStringState = { escaped: false, quote: false };
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;

    if (isJsonStringCharacter(stringState, character)) {
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (!depth) return index;
    }
  }

  return source.length;
};

const objectContents = (text: string, objectStart: number) => {
  return text.slice(objectStart + 1, objectEndAt(text, objectStart));
};

const propertyPrefixFor = (source: string, prefix: string, start: number): PropertyPrefix | undefined => {
  const before = source.slice(0, start).trimEnd();
  const container = currentContainerAt(source.slice(0, start));

  if (container?.kind !== "object" || (!before.endsWith("{") && !before.endsWith(","))) {
    return;
  }

  return {
    objectStart: container.start,
    prefix,
    start,
  };
};

const propertyPrefixAt = ({ position, text }: PropertyPrefixAt): PropertyPrefix | undefined => {
  const offset = offsetAt(text, position);
  const source = text.slice(0, offset);
  const closedMatch = /"([^"\r\n]*)"$/.exec(source);

  if (closedMatch) {
    const prefix = closedMatch[1]!;
    const property = propertyPrefixFor(source, prefix, offset - prefix.length - 2);

    if (property) {
      return property;
    }
  }

  const openingMatch = /"([^"\r\n]*)$/.exec(source);

  if (openingMatch) {
    const prefix = openingMatch[1]!;
    const property = propertyPrefixFor(source, prefix, offset - prefix.length - 1);

    if (property) {
      return property;
    }
  }

  const bareProperty = /([@\w-]*)$/.exec(source);

  if (!bareProperty) return;

  const barePrefix = bareProperty[1]!;
  const bareStart = offset - barePrefix.length;

  return propertyPrefixFor(source, barePrefix, bareStart);
};

const isWhenCondition = (text: string, property: PropertyPrefix) => {
  return /"@when"\s*:\s*$/.test(text.slice(0, property.objectStart));
};

const dataPathPrefixAt = ({ position, text }: DataPathPrefixAt): DataPathPrefix | undefined => {
  const offset = offsetAt(text, position);
  const source = text.slice(0, offset);
  const match = /"@data"\s*:\s*(?:\[\s*)?(?:"[^"\\]*"\s*,\s*)*"([^"\r\n]*)$/.exec(source);

  if (match) {
    const prefix = match[1]!;

    return {
      prefix,
      start: offset - prefix.length,
    };
  }

  const afterArrayValue = /"@data"\s*:\s*\[(?:"[^"\\]*"\s*,\s*)*$/.test(source);

  return afterArrayValue
    ? {
        needsQuotes: true,
        prefix: "",
        start: offset,
      }
    : undefined;
};

export const isRouteDataPathCompletion = (props: DataPathPrefixAt) => Boolean(dataPathPrefixAt(props));

const valuePrefixAt = ({ position, text }: ValuePrefixAt): ValuePrefix | undefined => {
  const offset = offsetAt(text, position);
  const source = text.slice(0, offset);

  const scalar = /"([^"\\]+)"\s*:\s*"([^"\r\n]*)$/.exec(source);
  const array = /"([^"\\]+)"\s*:\s*\[\s*((?:"[^"\\]*"\s*,\s*)*)"([^"\r\n]*)$/.exec(source);
  const afterArrayValue = /"([^"\\]+)"\s*:\s*\[\s*((?:"[^"\\]*"\s*,\s*)*)$/.exec(source);

  if (!scalar && !array && !afterArrayValue) return;

  const key = (scalar ?? array ?? afterArrayValue)![1]!;
  const previous = array?.[2] ?? afterArrayValue?.[2] ?? "";
  const prefix = scalar ? scalar[2]! : (array?.[3] ?? "");
  const objectStart = objectStartAt(source.slice(0, source.length - prefix.length - 1));

  if (objectStart === undefined || !/"@when"\s*:\s*$/.test(source.slice(0, objectStart))) {
    return;
  }

  return {
    key,
    ...(afterArrayValue ? { needsQuotes: true } : {}),
    objectStart,
    prefix,
    selected: [...previous.matchAll(/"([^"\\]*)"/g)].map((item) => item[1]!),
    start: offset - prefix.length,
  };
};

export const isRouteValueCompletion = (props: ValuePrefixAt) => Boolean(valuePrefixAt(props));

const definedProperties = (text: string, objectStart: number) => {
  return [...objectContents(text, objectStart).matchAll(/"([^"\\]+)"\s*:/g)].map((match) => match[1]!);
};

const whenConditionsFor = (text: string, objectStart: number) =>
  Object.fromEntries(
    [...objectContents(text, objectStart).matchAll(/"([^"\\]+)"\s*:\s*"([^"\\]*)"/g)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  );

const routeDataItem = (props: RouteDataItemProps): CompletionItem => {
  const { command, documentation, insertText, label, position, text } = props;

  const property = propertyPrefixAt({ position, text });
  const offset = offsetAt(text, position);
  const hasClosingQuote = property && text[offset] === '"';
  const preservesClosingQuote = hasClosingQuote && insertText.endsWith('"');
  const end = hasClosingQuote && !preservesClosingQuote ? offset + 1 : offset;
  const newText = preservesClosingQuote ? insertText.slice(0, -1) : insertText;

  return {
    ...(command ? { command } : {}),
    detail: "Dynamic route metadata",
    documentation,
    insertText,
    insertTextFormat: InsertTextFormat.Snippet,
    kind: CompletionItemKind.Property,
    label,
    preselect: true,
    sortText: `0_${label}`,
    ...(property ? { filterText: text.slice(property.start, end) } : {}),
    textEdit: {
      newText,
      range: rangeAt(text, property?.start ?? offset, end),
    },
  };
};

const routeConditionItem = (props: RouteConditionItemProps): CompletionItem => {
  const { name, position, property, text } = props;

  const offset = offsetAt(text, position);
  const end = text[offset] === '"' ? offset + 1 : offset;
  const hasValue = text[offset - 1] === '"' && text[offset] === '"';

  return {
    detail: "Dynamic route condition",
    documentation: `Matches the parent dynamic segment "[${name}]".`,
    filterText: text.slice(property.start, end),
    insertText: hasValue ? `${name}": "$1` : `"${name}": "$1"$0`,
    insertTextFormat: InsertTextFormat.Snippet,
    kind: CompletionItemKind.Property,
    label: name,
    preselect: true,
    sortText: `0_${name}`,
  };
};

const routeValueItem = (props: RouteValueItem): CompletionItem => {
  const { needsQuotes = false, position, text, value } = props;

  const prefix = valuePrefixAt({ position, text });
  const insertText = needsQuotes ? `"${value}"` : value;

  return {
    detail: value ? "Dynamic route value" : "Root route value",
    documentation: "Matches an available parent dynamic route value.",
    insertText,
    kind: CompletionItemKind.Value,
    label: value || '""',
    preselect: true,
    sortText: `0_${value}`,
    textEdit: {
      newText: insertText,
      range: rangeAt(text, prefix?.start ?? offsetAt(text, position), offsetAt(text, position)),
    },
  };
};

const routeDataPathItem = ({ position, prefix, source, text }: RouteDataPathItemProps): CompletionItem => {
  const offset = offsetAt(text, position);
  const preview = source.preview.trim().slice(0, 1800);
  const value = prefix.needsQuotes ? `"${source.value}"` : source.value;

  return {
    detail: "Route data source",
    documentation: {
      kind: "markdown",
      value: `JSON file relative to dataDir.\n\n\`\`\`json\n${preview}\n\`\`\``,
    },
    kind: CompletionItemKind.File,
    label: source.value,
    preselect: true,
    sortText: `0_${source.value}`,
    textEdit: {
      newText: value,
      range: rangeAt(text, prefix.start, offset),
    },
  };
};

const matchesConditions = (record: ParsedRouteRecord, conditions: Record<string, string>) =>
  Object.entries(record.when ?? {}).every(
    ([name, values]) => conditions[name] === undefined || values.includes(conditions[name]),
  );

const routeValueCompletionsFor = (props: RouteDataCompletionProps, prefix: ValuePrefix): CompletionItem[] => {
  const records = props.parentRecords?.[prefix.key] ?? [];
  const conditions = whenConditionsFor(props.text, prefix.objectStart);
  const values = new Set(
    records.filter((record) => matchesConditions(record, conditions)).map((record) => record.slug),
  );

  return [...values]
    .sort((left, right) => left.localeCompare(right))
    .filter((value) => value.startsWith(prefix.prefix) && !prefix.selected.includes(value))
    .map((value) =>
      routeValueItem({
        needsQuotes: prefix.needsQuotes,
        position: props.position,
        text: props.text,
        value,
      }),
    );
};

const routeDataPathCompletionsFor = (props: RouteDataCompletionProps, prefix: DataPathPrefix): CompletionItem[] =>
  props.dataPaths
    .filter((source) => source.value.startsWith(prefix.prefix))
    .map((source) =>
      routeDataPathItem({
        position: props.position,
        prefix,
        source,
        text: props.text,
      }),
    );

export const routeDataCompletionsFor = (props: RouteDataCompletionProps): CompletionItem[] => {
  const { parentParameters, position, text } = props;

  const dataPathPrefix = dataPathPrefixAt({ position, text });

  if (dataPathPrefix) {
    return routeDataPathCompletionsFor(props, dataPathPrefix);
  }

  const valuePrefix = valuePrefixAt({ position, text });

  if (valuePrefix) {
    return routeValueCompletionsFor(props, valuePrefix);
  }

  const property = propertyPrefixAt({ position, text });

  if (!property) return [];

  if (isWhenCondition(text, property)) {
    const existing = new Set(definedProperties(text, property.objectStart));

    return parentParameters
      .filter((name) => !existing.has(name))
      .map((name) => routeConditionItem({ name, position, property, text }))
      .filter((item) => String(item.label).startsWith(property.prefix));
  }

  const triggerSuggest = {
    command: "editor.action.triggerSuggest",
    title: "Show completion suggestions",
  };

  const items = [
    routeDataItem({
      documentation: "JSON data sources relative to dataDir.",
      insertText: '"@data": ["$1"]',
      label: "@data",
      position,
      text,
    }),
    routeDataItem({
      command: triggerSuggest,
      documentation: "Optional conditions for parent dynamic segments. A value can be a string or an array of strings.",
      insertText: '"@when": {\n\t$0\n}',
      label: "@when",
      position,
      text,
    }),
  ];

  return items.filter((item) => String(item.label).startsWith(property.prefix));
};
