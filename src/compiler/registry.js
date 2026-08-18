import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";

import * as parse5 from "parse5";

import { NabiError } from "../utils/errors.js";
import { listFiles, readText } from "../utils/files.js";

const reservedSourceDirectories = new Set(["pages", "shared"]);
const bareRefHelp =
  'Use a namespaced ref like "ui/button" for global components\nor a local ref like "@button" for page-local components.';

const normaliseRef = (ref) => {
  if (typeof ref !== "string") throw new NabiError(`Invalid component ref: "${ref}"`);
  const value = ref.trim();
  if (!value || isAbsolute(value) || value.includes("\\")) throw new NabiError(`Invalid component ref: "${ref}"`);
  if (value.startsWith("@")) {
    const segments = value.slice(1).split("/");
    if (
      !segments.length ||
      segments.some((segment) => !segment || segment.startsWith("@") || [".", ".."].includes(segment))
    )
      throw new NabiError(`Invalid component ref: "${ref}"`);
    return `@${segments.join("/")}`;
  }
  const segments = value.split("/");
  if (segments.length < 2) throw new NabiError(`Invalid component ref "${ref}".\n\n${bareRefHelp}`);
  if (segments.some((segment) => !segment || [".", ".."].includes(segment)))
    throw new NabiError(`Invalid component ref: "${ref}"`);
  if (reservedSourceDirectories.has(segments[0].toLowerCase()))
    throw new NabiError(`Invalid component namespace: "${segments[0]}"`);
  return segments.join("/");
};

const refFromPath = ({ path, root }) => {
  const source = relative(root, path).replaceAll("\\", "/");
  return normaliseRef(basename(source) === "index.html" ? dirname(source) : source.slice(0, -extname(source).length));
};

const resourcePath = ({ path, extension }) =>
  basename(path) === "index.html"
    ? join(dirname(path), extension === "css" ? "style.css" : "script.js")
    : `${path.slice(0, -extname(path).length)}.${extension}`;

const findHead = (node) => {
  if (node.tagName === "head") return node;
  for (const child of node.childNodes ?? []) {
    const head = findHead(child);
    if (head) return head;
  }
};

const isHeadTemplate = (template) =>
  Boolean(findHead(parse5.parse(template, { sourceCodeLocationInfo: true }))?.sourceCodeLocation?.startTag);

const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const parseSchema = (source) => {
  const match = frontmatter.exec(source);
  if (!match) return { template: source, props: new Set(), propValues: {} };
  const props = new Set();
  const propValues = {};
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
  return { template: source.slice(match[0].length), props, propValues };
};

export class ComponentRegistry {
  constructor({ components, localComponentPaths, sourcePath }) {
    this.components = components;
    this.localComponentPaths = localComponentPaths;
    this.sourcePath = sourcePath;
  }

  get(ref) {
    const safeRef = normaliseRef(ref);
    const component = this.components.get(safeRef);
    if (component) return component;
    const caseMismatch = [...this.components.keys()].find((key) => key.toLowerCase() === safeRef.toLowerCase());
    if (caseMismatch)
      throw new NabiError(`Component ref must match its source path exactly: "${safeRef}". Use "${caseMismatch}".`);
  }

  expectedPath(ref) {
    const safeRef = normaliseRef(ref);
    return safeRef.startsWith("@") ? `pages/**/${safeRef}/index.html` : join(this.sourcePath, safeRef, "index.html");
  }

  get size() {
    return this.components.size;
  }
}

const componentFromFile = async ({ path, root, scope, ref = refFromPath({ path, root }) }) => {
  const source = await readText(path);
  const { template, props, propValues } = parseSchema(source);
  return {
    ref,
    path,
    root: dirname(path),
    scope,
    template,
    props,
    propValues,
    isHeadTemplate: isHeadTemplate(template),
    stylePath: resourcePath({ path, extension: "css" }),
    scriptPath: resourcePath({ path, extension: "js" }),
  };
};

const localRefFromPath = ({ path, root }) => {
  const segments = relative(root, path).replaceAll("\\", "/").split("/");
  const fileName = segments.pop();
  const rootName = basename(root).slice(1);
  if (!fileName || !rootName) return;
  const directories = segments.map((segment) => segment.replace(/^@/, ""));
  if (fileName === "index.html") return normaliseRef(`@${[rootName, ...directories].join("/")}`);
  const name = fileName.slice(0, -extname(fileName).length).replace(/^@/, "");
  return normaliseRef(`@${[rootName, ...directories, name].join("/")}`);
};

const localComponentFiles = async (root) =>
  (await listFiles(root, [".html"])).flatMap((path) => {
    const ref = localRefFromPath({ path, root });
    return ref ? [{ path, ref }] : [];
  });

const isWithin = ({ path, directory }) => {
  const value = relative(directory, path);
  return value && !value.startsWith("..") && !isAbsolute(value);
};

const isGlobalComponentFile = ({ path, root, ignoredPaths = [] }) => {
  const segments = relative(root, path).replaceAll("\\", "/").split("/");
  const [namespace] = segments;
  return (
    segments.length >= 2 &&
    !ignoredPaths.some((directory) => isWithin({ path, directory })) &&
    !reservedSourceDirectories.has(namespace.toLowerCase()) &&
    !(segments.length === 2 && basename(path) === "index.html")
  );
};

export const createGlobalComponentRegistry = async ({ sourcePath, ignoredPaths }) => {
  const components = new Map();
  const paths = (await listFiles(sourcePath, [".html"])).filter((path) =>
    isGlobalComponentFile({ path, root: sourcePath, ignoredPaths }),
  );
  for (const path of paths) {
    const component = await componentFromFile({ path, root: sourcePath, scope: "global" });
    if (components.has(component.ref))
      throw new NabiError(
        `Duplicate global component ref "${component.ref}" from ${path} and ${components.get(component.ref).path}`,
      );
    components.set(component.ref, component);
  }
  return components;
};

export const createHybridComponentRegistry = async ({
  localComponentPaths = [],
  sourcePath,
  globalComponents,
  ignoredPaths,
}) => {
  const components = new Map(globalComponents ?? (await createGlobalComponentRegistry({ sourcePath, ignoredPaths })));
  for (const root of localComponentPaths) {
    const localRefs = new Map();
    for (const { path, ref } of await localComponentFiles(root)) {
      const previousPath = localRefs.get(ref);
      if (previousPath) throw new NabiError(`Duplicate local component ref "${ref}" from ${path} and ${previousPath}`);
      localRefs.set(ref, path);
      components.set(ref, await componentFromFile({ path, root, scope: "local", ref }));
    }
  }
  return new ComponentRegistry({ components, localComponentPaths, sourcePath });
};
