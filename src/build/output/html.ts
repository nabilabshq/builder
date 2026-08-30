import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import type { NabiConfig, SharedDependencies } from "@/types";
import type { HtmlNode } from "@/utils/html";
import { parseDocument, serializeHtml } from "@/utils/html";

import { sourcePathFromProject } from "./resources";

type SharedSource = { path: string; source: string };
type SharedSourceUrlProps = {
  baseRoute: string;
  directory: string;
  path: string;
  root: string;
};

type ReadSharedSourcesProps = {
  config: NabiConfig;
  directory: string;
  paths: string[];
  root: string;
};

type InlineSourceProps = {
  annotate: boolean;
  definition: InlineSharedElement;
  node: HtmlNode;
  rawBlock: (value: string) => string;
  sources: Map<string, SharedSource>;
};

type InlineSharedDependenciesProps = {
  annotate: boolean;
  config: NabiConfig;
  dependencies: SharedDependencies;
  html: string;
};

type InlineSharedElement = {
  annotationAttribute: string;
  inputTagName: string;
  outputTagName: string;
  removedAttributes: string[];
  sourceAttribute: string;
};

type SharedSourceDefinition = {
  dependencies: (dependencies: SharedDependencies) => string[];
  directory: string;
  element: InlineSharedElement;
  root: (config: NabiConfig) => string;
};

const findElement = (node: HtmlNode, tagName: string): HtmlNode | undefined => {
  if (node.tagName === tagName) return node;

  for (const child of node.childNodes ?? []) {
    const found = findElement(child, tagName);

    if (found) return found;
  }
};

const attribute = (node: HtmlNode, name: string) => node.attrs?.find((item) => item.name === name);

const inlineSharedElements = {
  script: {
    annotationAttribute: "data-src",
    inputTagName: "script",
    outputTagName: "script",
    removedAttributes: ["src"],
    sourceAttribute: "src",
  },
  stylesheet: {
    annotationAttribute: "data-href",
    inputTagName: "link",
    outputTagName: "style",
    removedAttributes: ["href", "rel"],
    sourceAttribute: "href",
  },
} satisfies Record<string, InlineSharedElement>;

const sharedSourceDefinitions = [
  {
    dependencies: (dependencies) => dependencies.styles,
    directory: "styles",
    element: inlineSharedElements.stylesheet,
    root: (config) => config.stylesPath,
  },
  {
    dependencies: (dependencies) => dependencies.scripts,
    directory: "js",
    element: inlineSharedElements.script,
    root: (config) => config.jsPath,
  },
] satisfies SharedSourceDefinition[];

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

const sharedSourceUrl = ({ baseRoute, directory, path, root }: SharedSourceUrlProps) =>
  `/${[baseRoute, directory, relative(root, path).replaceAll("\\", "/")].filter(Boolean).join("/")}`;

const readSharedSources = async ({ config, directory, paths, root }: ReadSharedSourcesProps) => {
  const entries = await Promise.all(
    [...new Set(paths)].map(async (path) => {
      const source = await readFile(path, "utf8");

      return [
        sharedSourceUrl({
          baseRoute: config.baseRoute,
          directory,
          path,
          root,
        }),
        {
          path: sourcePathFromProject({ config, path }),
          source,
        },
      ] as const;
    }),
  );

  return new Map(entries);
};

const inlineSharedSource = ({ annotate, definition, node, rawBlock, sources }: InlineSourceProps) => {
  if (node.tagName !== definition.inputTagName) return;

  const sourceAttribute = attribute(node, definition.sourceAttribute);
  const source = sourceAttribute ? sources.get(sourceAttribute.value) : undefined;

  if (!source) return;

  node.nodeName = definition.outputTagName;
  node.tagName = definition.outputTagName;
  node.attrs = (node.attrs ?? []).filter((item) => !definition.removedAttributes.includes(item.name));

  if (annotate) node.attrs.push({ name: definition.annotationAttribute, value: source.path });

  node.childNodes = [
    {
      nodeName: "#text",
      value: rawBlock(
        source.source.replace(new RegExp(`</${definition.outputTagName}`, "gi"), `<\\/${definition.outputTagName}`),
      ),
    },
  ];
};

export const inlineSharedDependencies = async (props: InlineSharedDependenciesProps) => {
  const { annotate, config, dependencies, html } = props;

  const sources = await Promise.all(
    sharedSourceDefinitions.map(async (definition) => ({
      definition,
      sources: await readSharedSources({
        config,
        directory: definition.directory,
        paths: definition.dependencies(dependencies),
        root: definition.root(config),
      }),
    })),
  );

  const document = parseDocument(html);
  const rawBlocks: { marker: string; value: string }[] = [];
  const rawBlock = (value: string) => {
    const marker = `__NABI_SHARED_${rawBlocks.length}__`;

    rawBlocks.push({ marker, value });

    return marker;
  };

  const visit = (node: HtmlNode) => {
    for (const entry of sources) {
      inlineSharedSource({
        annotate,
        definition: entry.definition.element,
        node,
        rawBlock,
        sources: entry.sources,
      });
    }

    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };

  visit(document);

  return rawBlocks.reduce((output, block) => output.replace(block.marker, block.value), serializeHtml(document));
};

export const bodyOutput = ({ config, html }: { config: NabiConfig; html: string }): string => {
  const document = parseDocument(html);
  const body = findElement(document, "body");
  const styles = extractElements(document, "style");
  const scripts = extractElements(document, "script");
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
