import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";

import * as parse5 from "parse5";

import { NabiError } from "../utils/errors.js";
import { listFiles, readText } from "../utils/files.js";

const normaliseRef = (ref) => {
  if (typeof ref !== "string") throw new NabiError(`Invalid component ref: "${ref}"`);
  const value = ref.trim();
  if (!value || isAbsolute(value) || value.includes("\\")) throw new NabiError(`Invalid component ref: "${ref}"`);
  const segments = value.split("/");
  if (segments.some((segment) => !segment || [".", ".."].includes(segment)))
    throw new NabiError(`Invalid component ref: "${ref}"`);
  return segments.join("/").toLowerCase();
};

const refFromPath = ({ path, root }) => {
  const source = relative(root, path).replaceAll("\\", "/");
  return normaliseRef(basename(source) === "index.html" ? dirname(source) : source.slice(0, -extname(source).length));
};

const resourcePath = ({ path, root, ref, extension }) => {
  if (basename(path) === "index.html") return join(root, ref, extension === "css" ? "style.css" : "script.js");
  return path.slice(0, -extname(path).length) + `.${extension}`;
};

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
  constructor({ components, localComponentsPath, sharedComponentsPath }) {
    this.components = components;
    this.localComponentsPath = localComponentsPath;
    this.sharedComponentsPath = sharedComponentsPath;
  }

  get(ref) {
    return this.components.get(normaliseRef(ref));
  }

  expectedPath(ref) {
    const safeRef = normaliseRef(ref);
    return join(this.sharedComponentsPath, safeRef, "index.html");
  }

  get size() {
    return this.components.size;
  }
}

const componentFromFile = async ({ path, root, scope }) => {
  const ref = refFromPath({ path, root });
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
    stylePath: resourcePath({ path, root, ref, extension: "css" }),
    scriptPath: resourcePath({ path, root, ref, extension: "js" }),
  };
};

export const createHybridComponentRegistry = async ({ localComponentsPath, sharedComponentsPath }) => {
  const components = new Map();
  const localRefs = new Set();
  const register = async (root, scope) => {
    const paths = await listFiles(root, [".html"]);
    for (const path of paths) {
      const component = await componentFromFile({ path, root, scope });
      if (scope === "local" && localRefs.has(component.ref))
        throw new NabiError(
          `Duplicate local component ref "${component.ref}" from ${path} and ${components.get(component.ref).path}`,
        );
      if (scope === "shared" && components.has(component.ref))
        throw new NabiError(
          `Duplicate shared component ref "${component.ref}" from ${path} and ${components.get(component.ref).path}`,
        );
      if (scope === "local") localRefs.add(component.ref);
      components.set(component.ref, component);
    }
  };
  await register(sharedComponentsPath, "shared");
  await register(localComponentsPath, "local");
  return new ComponentRegistry({ components, localComponentsPath, sharedComponentsPath });
};
