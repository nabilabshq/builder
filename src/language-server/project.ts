import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ComponentRegistry, createGlobalComponentRegistry, createHybridComponentRegistry } from "@/compiler/registry";
import { loadConfig } from "@/config";
import { localComponentPaths } from "@/routing";
import type { Component, NabiConfig, SharedDependencyType } from "@/types";
import { fileExists, listFiles, readText } from "@/utils/files";
import type { HtmlNode } from "@/utils/html";
import { HTML_NAMESPACE, parseFragment } from "@/utils/html";
import { inside } from "@/utils/paths";

export type DependencyType = SharedDependencyType;
export type ComponentMetadata = {
  component: Component;
  filePath: string;
  name: string;
  props: string[];
  propValues: Record<string, string[]>;
  slots: string[];
};

type SharedFile = { path: string; preview: string; value: string };
type FindProjectRootOptions = { filePath: string; workspaceRoots: string[] };

const VARIABLE = /{{([\w:-]+)}}/g;
const IGNORED_VARIABLES = new Set(["children", "slot"]);

const toPosix = (path: string) => path.replaceAll("\\", "/");

export const pathFromUri = (uri: string) => fileURLToPath(uri);
export const uriFromPath = (path: string) => pathToFileURL(path).href;

const metadataFromComponent = (component: Component): ComponentMetadata => {
  const props = new Set<string>();
  const slots = new Set<string>();

  const document = parseFragment(component.template, true);

  const variablesFrom = (value: string) => {
    for (const [, name] of value.matchAll(VARIABLE)) {
      if (!IGNORED_VARIABLES.has(name)) {
        props.add(name);
      }
    }
  };

  const visit = (node: HtmlNode) => {
    if (node.nodeName === "#text") variablesFrom(node.value ?? "");

    for (const attribute of node.attrs ?? []) {
      variablesFrom(attribute.value);
    }

    if (node.tagName === "slot" && node.namespaceURI === HTML_NAMESPACE) {
      slots.add(node.attrs?.find((attribute) => attribute.name === "name")?.value || "default");
    }

    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };

  for (const child of document.childNodes) {
    visit(child);
  }

  for (const prop of component.props) {
    props.add(prop);
  }

  return {
    component,
    filePath: component.path,
    name: component.ref,
    props: [...props].sort(),
    propValues: component.propValues,
    slots: [...slots].sort(),
  };
};

const findProjectRoot = async ({ filePath, workspaceRoots }: FindProjectRootOptions) => {
  let current = dirname(filePath);

  while (true) {
    if (await fileExists(resolve(current, "nabi.config.js"))) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) break;

    current = parent;
  }

  return (
    workspaceRoots.filter((root) => inside(root, filePath)).sort((left, right) => right.length - left.length)[0] ??
    dirname(filePath)
  );
};

export class ProjectContext {
  readonly root: string;
  readonly config: NabiConfig;
  readonly registries = new Map<string, ComponentRegistry>();
  readonly sharedFiles = new Map<DependencyType, SharedFile[]>();
  globalComponents?: Map<string, Component>;

  constructor({ config, root }: { config: NabiConfig; root: string }) {
    this.root = root;
    this.config = config;
  }

  async registryFor(filePath: string) {
    const localPaths = await localComponentPaths({
      directory: dirname(filePath),
      rootPath: this.config.pagesPath,
    });

    const key = localPaths.join("\0");
    const previous = this.registries.get(key);

    if (previous) return previous;

    const ignoredComponentPaths = [this.config.pagesPath, this.config.sharedPath];

    this.globalComponents ??= await createGlobalComponentRegistry({
      ignoredPaths: ignoredComponentPaths,
      reservedSourceDirectories: [this.config.pagesDir, this.config.sharedDir],
      sourcePath: this.config.srcPath,
    });

    const registry = await createHybridComponentRegistry({
      globalComponents: this.globalComponents,
      ignoredPaths: ignoredComponentPaths,
      localComponentPaths: localPaths,
      pagesDir: this.config.pagesDir,
      reservedSourceDirectories: [this.config.pagesDir, this.config.sharedDir],
      sourcePath: this.config.srcPath,
    });

    this.registries.set(key, registry);

    return registry;
  }

  async componentMetadata(filePath: string) {
    const registry = await this.registryFor(filePath);

    return new Map(
      [...registry.components.values()].map((component) => [component.ref, metadataFromComponent(component)]),
    );
  }

  async localComponentOwner(filePath: string) {
    const registry = await this.registryFor(filePath);
    const component = [...registry.components.values()].find((entry) => entry.path === filePath);

    if (!component || component.scope !== "local" || component.ref.split("/").length > 1) return;

    return component.ref;
  }

  async sharedPaths(type: DependencyType) {
    const previous = this.sharedFiles.get(type);

    if (previous) return previous;

    const root = type === "script" ? this.config.jsPath : this.config.stylesPath;
    const extension = type === "script" ? ".js" : ".css";
    const files = await listFiles(root, [extension]);

    const result = await Promise.all(
      files.map(async (path) => ({
        path,
        preview: await readText(path),
        value: toPosix(relative(root, path)),
      })),
    );

    this.sharedFiles.set(type, result);

    return result;
  }
}

type WorkspaceFolder = string | { uri: string };

export const createProjectManager = ({ workspaceFolders = [] }: { workspaceFolders?: WorkspaceFolder[] } = {}) => {
  const workspaceRoots = workspaceFolders.map((folder) =>
    pathFromUri(typeof folder === "string" ? folder : folder.uri),
  );

  const contexts = new Map<string, ProjectContext>();

  const contextForUri = async (uri: string) => {
    const filePath = pathFromUri(uri);
    const root = await findProjectRoot({ filePath, workspaceRoots });
    const existing = contexts.get(root);

    if (existing) return existing;

    const context = new ProjectContext({ config: await loadConfig({ cwd: root }), root });

    contexts.set(root, context);

    return context;
  };

  return {
    contextForUri,
    invalidate: () => contexts.clear(),
  };
};

export type ProjectManager = ReturnType<typeof createProjectManager>;
