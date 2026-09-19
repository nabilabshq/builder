import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";

import * as parse5 from "parse5";

import type { Component, ComponentScope } from "@/types";
import { NabiError } from "@/utils/errors";
import { listFiles, readText } from "@/utils/files";
import type { HtmlNode } from "@/utils/html";
import { isDotSegment } from "@/utils/paths";

type NormaliseRef = {
  ref: unknown;
  reservedSourceDirectories?: Set<string>;
};

type Constructor = {
  components: Map<string, Component>;
  localComponentPaths: string[];
  pagesDir: string;
  reservedSourceDirectories: Set<string>;
  sourcePath: string;
};

type ComponentFromFile = {
  path: string;
  ref?: string;
  root: string;
  scope: ComponentScope;
};

type GlobalComponentFile = {
  ignoredPaths?: string[];
  path: string;
  reservedSourceDirectories: Set<string>;
  root: string;
};

type GlobalComponentRegistry = {
  ignoredPaths?: string[];
  reservedSourceDirectories?: string[];
  sourcePath: string;
};

type HybridComponentRegistry = {
  globalComponents?: Map<string, Component>;
  ignoredPaths?: string[];
  localComponentPaths?: string[];
  pagesDir?: string;
  reservedSourceDirectories?: string[];
  sourcePath: string;
};

export const normaliseRef = ({ ref, reservedSourceDirectories = new Set() }: NormaliseRef) => {
  const error = new NabiError(`Invalid component ref: "${String(ref)}"`);

  if (typeof ref !== "string") {
    throw error;
  }

  const value = ref.trim();

  if (!value || isAbsolute(value) || value.includes("\\")) {
    throw error;
  }

  if (value.startsWith("@")) {
    const segments = value.slice(1).split("/");

    if (segments.some((segment) => !segment || segment.startsWith("@") || isDotSegment(segment))) {
      throw error;
    }

    return `@${segments.join("/")}`;
  }

  const segments = value.split("/");

  if (segments.length < 2) {
    throw new NabiError(`Invalid component ref "${ref}".
      Use a namespaced ref like "ui/button" for global components\nor a local ref like "@button" for page-local components.`);
  }

  if (segments.some((segment) => !segment || isDotSegment(segment))) {
    throw error;
  }

  if (reservedSourceDirectories.has(segments[0].toLowerCase())) {
    throw new NabiError(`Invalid component namespace: "${segments[0]}"`);
  }

  return segments.join("/");
};

const refFromPath = ({ path, root }: { path: string; root: string }) => {
  const source = relative(root, path).replaceAll("\\", "/");

  return normaliseRef({
    ref: basename(source) === "index.html" ? dirname(source) : source.slice(0, -extname(source).length),
  });
};

const resourcePath = ({ extension, path }: { extension: "css" | "js"; path: string }) =>
  basename(path) === "index.html"
    ? join(dirname(path), extension === "css" ? "style.css" : "script.js")
    : `${path.slice(0, -extname(path).length)}.${extension}`;

const findHead = (node: HtmlNode): HtmlNode | undefined => {
  if (node.tagName === "head") return node;

  for (const child of node.childNodes ?? []) {
    const head = findHead(child);

    if (head) return head;
  }
};

const isHeadTemplate = (template: string) =>
  Boolean(
    findHead(
      parse5.parse(template, {
        sourceCodeLocationInfo: true,
      }) as HtmlNode,
    )?.sourceCodeLocation?.startTag,
  );

const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const parseSchema = (source: string): Pick<Component, "template" | "props" | "propValues"> => {
  const match = frontmatter.exec(source);

  if (!match) {
    return {
      props: new Set<string>(),
      propValues: {},
      template: source,
    };
  }

  const props = new Set<string>();
  const propValues: Record<string, string[]> = {};

  for (const line of match[1].split(/\r?\n/)) {
    const declaration = /^\s*([\w:-]+)\s*:\s*(.*?)\s*$/.exec(line);

    if (!declaration) continue;

    const name = declaration[1] === "variants" ? "variant" : declaration[1];

    props.add(name);
    propValues[name] = declaration[2]
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return {
    props,
    propValues,
    template: source.slice(match[0].length),
  };
};

export class ComponentRegistry {
  readonly components: Map<string, Component>;
  readonly localComponentPaths: string[];
  readonly pagesDir: string;
  readonly reservedSourceDirectories: Set<string>;
  readonly sourcePath: string;

  constructor({ components, localComponentPaths, pagesDir, reservedSourceDirectories, sourcePath }: Constructor) {
    this.components = components;
    this.localComponentPaths = localComponentPaths;
    this.pagesDir = pagesDir;
    this.reservedSourceDirectories = reservedSourceDirectories;
    this.sourcePath = sourcePath;
  }

  get(ref: unknown) {
    const safeRef = normaliseRef({ ref, reservedSourceDirectories: this.reservedSourceDirectories });
    const component = this.components.get(safeRef);

    if (component) return component;

    const caseMismatch = [...this.components.keys()].find((key) => key.toLowerCase() === safeRef.toLowerCase());

    if (caseMismatch) {
      throw new NabiError(`Component ref must match its source path exactly: "${safeRef}". Use "${caseMismatch}".`);
    }
  }

  expectedPath(ref: unknown) {
    const safeRef = normaliseRef({ ref, reservedSourceDirectories: this.reservedSourceDirectories });

    return safeRef.startsWith("@")
      ? `${this.pagesDir}/**/${safeRef}/index.html`
      : join(this.sourcePath, safeRef, "index.html");
  }

  get size() {
    return this.components.size;
  }
}

const componentFromFile = async (props: ComponentFromFile): Promise<Component> => {
  const { path, root, ref = refFromPath({ path, root }), scope } = props;

  const source = await readText(path);
  const { props: componentProps, propValues, template } = parseSchema(source);

  return {
    isHeadTemplate: isHeadTemplate(template),
    path,
    props: componentProps,
    propValues,
    ref,
    root: dirname(path),
    scope,
    scriptPath: resourcePath({ extension: "js", path }),
    stylePath: resourcePath({ extension: "css", path }),
    template,
  };
};

const localRefFromPath = ({ path, root }: { path: string; root: string }) => {
  const segments = relative(root, path).replaceAll("\\", "/").split("/");
  const fileName = segments.pop();
  const rootName = basename(root).slice(1);

  if (!fileName || !rootName) return;

  const directories = segments.map((segment) => segment.replace(/^@/, ""));

  if (fileName === "index.html") {
    return normaliseRef({ ref: `@${[rootName, ...directories].join("/")}` });
  }

  const name = fileName.slice(0, -extname(fileName).length).replace(/^@/, "");

  return normaliseRef({ ref: `@${[rootName, ...directories, name].join("/")}` });
};

const localComponentFiles = async (root: string) =>
  (await listFiles(root, [".html"])).flatMap((path) => {
    const ref = localRefFromPath({ path, root });

    return ref ? [{ path, ref }] : [];
  });

const isWithin = ({ directory, path }: { directory: string; path: string }) => {
  const value = relative(directory, path);

  return value && !value.startsWith("..") && !isAbsolute(value);
};

const isGlobalComponentFile = (props: GlobalComponentFile) => {
  const { ignoredPaths = [], path, reservedSourceDirectories, root } = props;

  const segments = relative(root, path).replaceAll("\\", "/").split("/");
  const [namespace] = segments;

  return (
    segments.length >= 2 &&
    !ignoredPaths.some((directory) => isWithin({ directory, path })) &&
    !reservedSourceDirectories.has(namespace.toLowerCase()) &&
    !(segments.length === 2 && basename(path) === "index.html")
  );
};

export const createGlobalComponentRegistry = async (props: GlobalComponentRegistry) => {
  const { ignoredPaths = [], reservedSourceDirectories = [], sourcePath } = props;

  const reservedDirectories = new Set(reservedSourceDirectories.map((directory) => directory.toLowerCase()));

  const components = new Map<string, Component>();

  const paths = (await listFiles(sourcePath, [".html"])).filter((path) =>
    isGlobalComponentFile({ ignoredPaths, path, reservedSourceDirectories: reservedDirectories, root: sourcePath }),
  );

  for (const path of paths) {
    const component = await componentFromFile({ path, root: sourcePath, scope: "global" });

    if (components.has(component.ref)) {
      throw new NabiError(
        `Duplicate global component ref "${component.ref}" from ${path} and ${components.get(component.ref)?.path}`,
      );
    }

    components.set(component.ref, component);
  }

  return components;
};

export const createHybridComponentRegistry = async (props: HybridComponentRegistry) => {
  const {
    globalComponents,
    ignoredPaths,
    localComponentPaths = [],
    pagesDir = "pages",
    reservedSourceDirectories = [],
    sourcePath,
  } = props;

  const reservedDirectories = new Set(reservedSourceDirectories.map((directory) => directory.toLowerCase()));

  const components = new Map(
    globalComponents ??
      (await createGlobalComponentRegistry({
        ignoredPaths,
        reservedSourceDirectories,
        sourcePath,
      })),
  );

  for (const root of localComponentPaths) {
    const localRefs = new Map<string, string>();

    for (const { path, ref } of await localComponentFiles(root)) {
      const previousPath = localRefs.get(ref);

      if (previousPath) {
        throw new NabiError(`Duplicate local component ref "${ref}" from ${path} and ${previousPath}`);
      }

      localRefs.set(ref, path);
      components.set(ref, await componentFromFile({ path, ref, root, scope: "local" }));
    }
  }

  return new ComponentRegistry({
    components,
    localComponentPaths,
    pagesDir,
    reservedSourceDirectories: reservedDirectories,
    sourcePath,
  });
};
