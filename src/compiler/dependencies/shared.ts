import { extname, relative } from "node:path";

import type { NabiConfig, SharedDependencies, SharedDependencyType } from "@/types";
import { NabiError } from "@/utils/errors";
import { fileExists } from "@/utils/files";
import type { HtmlNode } from "@/utils/html";
import { HTML_NAMESPACE, parseDocument, serializeHtml } from "@/utils/html";
import { isDotSegment, resolveWithin } from "@/utils/paths";

type ResolveSharedDependencyProps = {
  config: NabiConfig;
  page: string;
  type: SharedDependencyType;
  value: string;
};
type ResolveSharedDependenciesProps = {
  config: NabiConfig;
  html: string;
  page: string;
};
type ResolveSharedDependencyNodeProps = {
  config: NabiConfig;
  dependencies: SharedDependencies;
  node: HtmlNode;
  page: string;
};
type ResolveSharedFileProps = {
  config: NabiConfig;
  extension: string;
  label: string;
  page: string;
  root: string;
  value: string;
};
type SharedDependencyDefinition = Pick<ResolveSharedFileProps, "extension" | "label" | "root">;
type SharedDependencyTag = {
  conflictAttribute: string;
  dependency: keyof SharedDependencies;
  directory: string;
  outputAttribute: string;
  rel?: string;
  type: SharedDependencyType;
};

const sharedDependencyTags = {
  link: {
    conflictAttribute: "href",
    dependency: "styles",
    directory: "styles",
    outputAttribute: "href",
    rel: "stylesheet",
    type: "stylesheet",
  },
  script: {
    conflictAttribute: "src",
    dependency: "scripts",
    directory: "js",
    outputAttribute: "src",
    type: "script",
  },
} satisfies Record<string, SharedDependencyTag>;

const sharedDependencyTag = (node: HtmlNode): SharedDependencyTag | undefined => {
  if (node.tagName === "link") return sharedDependencyTags.link;

  if (node.tagName === "script") return sharedDependencyTags.script;
};

const attribute = (node: HtmlNode, name: string) => node.attrs?.find((item) => item.name === name);

const addAttribute = (node: HtmlNode, name: string, value: string) => {
  (node.attrs ??= []).push({ name, value });
};

const removeAttribute = (node: HtmlNode, name: string) => {
  const index = node.attrs?.findIndex((item) => item.name === name) ?? -1;

  if (index >= 0) node.attrs?.splice(index, 1);
};

const sharedPath = (label: string, root: string, value: string) => {
  if (!value || value.includes("\\") || value.split("/").some((segment) => !segment || isDotSegment(segment))) {
    throw new NabiError(`Invalid shared ${label} path: "${value}"`);
  }

  return resolveWithin(root, value, `Shared ${label}`);
};

const referenceUrl = (config: NabiConfig, directory: string, value: string) =>
  `/${[config.baseRoute, directory, value].filter(Boolean).join("/")}`;

const expectedPath = (config: NabiConfig, path: string) => relative(config.cwd, path).replaceAll("\\", "/");

const resolveSharedFile = async (props: ResolveSharedFileProps) => {
  const { config, extension, label, page, root, value } = props;

  if (extname(value).toLowerCase() !== extension) {
    throw new NabiError(`Invalid shared ${label} type: "${value}"\n\nUsed in:\n${page}`);
  }

  const path = sharedPath(label, root, value);

  if (!(await fileExists(path))) {
    throw new NabiError(
      `Shared ${label} not found: "${value}"\n\nUsed in:\n${page}\n\nExpected:\n${expectedPath(config, path)}`,
    );
  }

  return path;
};

export const resolveSharedDependency = (props: ResolveSharedDependencyProps) => {
  const { config, page, type, value } = props;

  const definitions = {
    script: {
      extension: ".js",
      label: "script",
      root: config.jsPath,
    },
    stylesheet: {
      extension: ".css",
      label: "stylesheet",
      root: config.stylesPath,
    },
  } satisfies Record<SharedDependencyType, SharedDependencyDefinition>;

  return resolveSharedFile({ config, page, value, ...definitions[type] });
};

const resolveSharedDependencyNode = async (props: ResolveSharedDependencyNodeProps) => {
  const { config, dependencies, node, page } = props;

  if (node.namespaceURI !== HTML_NAMESPACE) return;

  const definition = sharedDependencyTag(node);

  if (!definition) return;

  const use = attribute(node, "use");

  if (!use) return;

  if (attribute(node, definition.conflictAttribute)) {
    throw new NabiError(
      `Invalid <${node.tagName}>: "use" cannot be combined with "${definition.conflictAttribute}"\n\nUsed in:\n${page}`,
    );
  }

  dependencies[definition.dependency].push(
    await resolveSharedDependency({
      config,
      page,
      type: definition.type,
      value: use.value,
    }),
  );

  removeAttribute(node, "use");

  if (definition.rel && !attribute(node, "rel")) {
    addAttribute(node, "rel", definition.rel);
  }

  addAttribute(node, definition.outputAttribute, referenceUrl(config, definition.directory, use.value));
};

export const resolveSharedDependencies = async (props: ResolveSharedDependenciesProps) => {
  const { config, html, page } = props;

  const document = parseDocument(html);
  const dependencies: SharedDependencies = { scripts: [], styles: [] };

  const visit = async (node: HtmlNode) => {
    await resolveSharedDependencyNode({ config, dependencies, node, page });

    for (const child of node.childNodes ?? []) {
      await visit(child);
    }
  };

  await visit(document);

  return {
    dependencies,
    html: serializeHtml(document),
  };
};
