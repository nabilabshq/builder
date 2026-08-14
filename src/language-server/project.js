import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as parse5 from "parse5";

import { createHybridComponentRegistry } from "../compiler/registry.js";
import { loadConfig } from "../config.js";
import { fileExists, listFiles, readText } from "../utils/files.js";
import { inside } from "../utils/paths.js";

const variable = /{{([\w:-]+)}}/g;
const ignoredVariables = new Set(["children", "slot"]);
const toPosix = (path) => path.replaceAll("\\", "/");

export const pathFromUri = (uri) => fileURLToPath(uri);
export const uriFromPath = (path) => pathToFileURL(path).href;

const metadataFromComponent = (component) => {
  const props = new Set();
  const slots = new Set();
  const document = parse5.parseFragment(component.template, { sourceCodeLocationInfo: true });
  const variablesFrom = (value) => {
    for (const [, name] of value.matchAll(variable)) if (!ignoredVariables.has(name)) props.add(name);
  };
  const visit = (node) => {
    if (node.nodeName === "#text") variablesFrom(node.value);
    for (const attribute of node.attrs ?? []) variablesFrom(attribute.value);
    if (node.tagName === "slot" && node.namespaceURI === "http://www.w3.org/1999/xhtml")
      slots.add(node.attrs?.find((attribute) => attribute.name === "name")?.value || "default");
    for (const child of node.childNodes ?? []) visit(child);
  };
  for (const child of document.childNodes ?? []) visit(child);
  for (const prop of component.props) props.add(prop);
  return {
    name: component.ref,
    filePath: component.path,
    props: [...props].sort(),
    propValues: component.propValues,
    slots: [...slots].sort(),
    component,
  };
};

const findProjectRoot = async ({ filePath, workspaceRoots }) => {
  let current = dirname(filePath);
  while (true) {
    if (await fileExists(resolve(current, "nabi.config.js"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return (
    workspaceRoots.filter((root) => inside(root, filePath)).sort((left, right) => right.length - left.length)[0] ??
    dirname(filePath)
  );
};

class ProjectContext {
  constructor({ root, config }) {
    this.root = root;
    this.config = config;
    this.registries = new Map();
    this.sharedFiles = new Map();
  }

  async registryFor(filePath) {
    const localComponentsPath = resolve(dirname(filePath), "components");
    if (!this.registries.has(localComponentsPath)) {
      const registry = await createHybridComponentRegistry({
        localComponentsPath,
        sharedComponentsPath: this.config.sharedComponentsPath,
      });
      this.registries.set(localComponentsPath, registry);
    }
    return this.registries.get(localComponentsPath);
  }

  async componentMetadata(filePath) {
    const registry = await this.registryFor(filePath);
    return new Map(
      [...registry.components.values()].map((component) => [component.ref, metadataFromComponent(component)]),
    );
  }

  async sharedPaths(type) {
    if (!this.sharedFiles.has(type)) {
      const root = type === "script" ? this.config.sharedJsPath : this.config.sharedStylesPath;
      const extension = type === "script" ? ".js" : ".css";
      const files = await listFiles(root, [extension]);
      this.sharedFiles.set(
        type,
        await Promise.all(
          files.map(async (path) => ({
            path,
            value: toPosix(relative(root, path)),
            preview: await readText(path),
          })),
        ),
      );
    }
    return this.sharedFiles.get(type);
  }
}

export const createProjectManager = ({ workspaceFolders = [] } = {}) => {
  const workspaceRoots = workspaceFolders.map((folder) =>
    pathFromUri(typeof folder === "string" ? folder : folder.uri),
  );
  const contexts = new Map();
  const contextForUri = async (uri) => {
    const filePath = pathFromUri(uri);
    const root = await findProjectRoot({ filePath, workspaceRoots });
    if (!contexts.has(root)) contexts.set(root, new ProjectContext({ root, config: await loadConfig({ cwd: root }) }));
    return contexts.get(root);
  };
  return {
    contextForUri,
    invalidate: () => contexts.clear(),
  };
};
