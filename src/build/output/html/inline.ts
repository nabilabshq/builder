import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { minifyCss, minifyJs } from "@/build/minify";
import type { NabiConfig, SharedDependencies, SharedDependencyType } from "@/types";
import type { HtmlNode } from "@/utils/html";
import { parseDocument, serializeHtml } from "@/utils/html";

import { sourcePathFromProject } from "../resources";

type SharedSource = { path: string; source: string };
export type SharedSourceCache = Map<string, Promise<SharedSource>>;

type SharedSourceUrlProps = {
  baseRoute: string;
  directory: string;
  path: string;
  root: string;
};

type ReadSharedSourcesProps = {
  cache: SharedSourceCache;
  config: NabiConfig;
  directory: string;
  paths: string[];
  root: string;
  transform: (source: string) => Promise<string> | string;
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
  cache: SharedSourceCache;
  config: NabiConfig;
  dependencies: SharedDependencies;
  html: string;
  types?: SharedDependencyType[];
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
  type: SharedDependencyType;
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
    type: "stylesheet",
  },
  {
    dependencies: (dependencies) => dependencies.scripts,
    directory: "js",
    element: inlineSharedElements.script,
    root: (config) => config.jsPath,
    type: "script",
  },
] satisfies SharedSourceDefinition[];

const sharedSourceUrl = (props: SharedSourceUrlProps) => {
  const { baseRoute, directory, path, root } = props;

  return `/${[baseRoute, directory, relative(root, path).replaceAll("\\", "/")].filter(Boolean).join("/")}`;
};

const readSharedSources = async (props: ReadSharedSourcesProps) => {
  const { cache, config, directory, paths, root, transform } = props;

  const entries = await Promise.all(
    [...new Set(paths)].map(async (path) => {
      const existing = cache.get(path);

      const source =
        existing ??
        (async () => ({
          path: sourcePathFromProject({ config, path }),
          source: await transform(await readFile(path, "utf8")),
        }))();

      if (!existing) {
        cache.set(path, source);
      }

      return [
        sharedSourceUrl({
          baseRoute: config.baseRoute,
          directory,
          path,
          root,
        }),
        await source,
      ] as const;
    }),
  );

  return new Map(entries);
};

const inlineSharedSource = (props: InlineSourceProps) => {
  const { annotate, definition, node, rawBlock, sources } = props;

  if (node.tagName !== definition.inputTagName) return;

  const sourceAttribute = attribute(node, definition.sourceAttribute);
  const source = sourceAttribute ? sources.get(sourceAttribute.value) : undefined;

  if (!source) return;

  node.nodeName = definition.outputTagName;
  node.tagName = definition.outputTagName;
  node.attrs = (node.attrs ?? []).filter((item) => !definition.removedAttributes.includes(item.name));

  if (annotate) {
    node.attrs.push({
      name: definition.annotationAttribute,
      value: source.path,
    });
  }

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
  const { annotate, cache, config, dependencies, html, types } = props;

  const definitions = types
    ? sharedSourceDefinitions.filter((definition) => types.includes(definition.type))
    : sharedSourceDefinitions;

  const sources = await Promise.all(
    definitions.map(async (definition) => ({
      definition,
      sources: await readSharedSources({
        cache,
        config,
        directory: definition.directory,
        paths: definition.dependencies(dependencies),
        root: definition.root(config),
        transform:
          definition.type === "stylesheet"
            ? config.minify.css
              ? minifyCss
              : (source) => source
            : config.minify.js
              ? minifyJs
              : (source) => source,
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

  return rawBlocks.reduce((output, block) => {
    return output.replace(block.marker, block.value);
  }, serializeHtml(document));
};
