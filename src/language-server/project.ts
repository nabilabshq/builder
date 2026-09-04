import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ComponentRegistry, createGlobalComponentRegistry, createHybridComponentRegistry } from "@/compiler/registry";
import { loadConfig } from "@/config";
import { discoverPages, localComponentPaths } from "@/routing";
import { routeDataFor } from "@/routing/dynamic/data";
import { dynamicSegmentsFor } from "@/routing/dynamic/segments";
import type { ParsedRouteRecord } from "@/routing/dynamic/types";
import type { Component, NabiConfig, SharedDependencyType } from "@/types";
import { fileExists, listFiles, readText } from "@/utils/files";
import type { HtmlNode } from "@/utils/html";
import { HTML_NAMESPACE, parseFragment } from "@/utils/html";
import { inside } from "@/utils/paths";

export type DependencyType = SharedDependencyType;
export type RouteDataFile = { preview: string; value: string };
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

type WorkspaceFolder = string | { uri: string };
type CreateProjectManager = { workspaceFolders?: WorkspaceFolder[] };

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
  routeDiscovery?: Promise<void>;

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

    if (!component || component.scope !== "local" || component.ref.split("/").length > 1) {
      return;
    }

    return component.ref;
  }

  private parentRouteSegments(filePath: string) {
    const pagePath = resolve(dirname(filePath), "index.html");
    const { dynamicSegments } = dynamicSegmentsFor({
      path: pagePath,
      rootPath: this.config.pagesPath,
      routeFileName: this.config.routeFileName,
    });

    const currentIndex = dynamicSegments.findIndex((segment) => {
      return segment.routeConfigPath === filePath;
    });

    return currentIndex < 1 ? [] : dynamicSegments.slice(0, currentIndex);
  }

  parentRouteParameters(filePath: string) {
    const segments = this.parentRouteSegments(filePath);

    return segments.map((segment) => segment.name);
  }

  async parentRouteRecords(filePath: string): Promise<Record<string, ParsedRouteRecord[]>> {
    const segments = this.parentRouteSegments(filePath);
    const configCache = new Map<string, Promise<unknown>>();
    const dataCache = new Map();

    const records = await Promise.all(
      segments.map(async (segment) => {
        const values = await routeDataFor({
          configCache,
          dataCache,
          dataPath: this.config.dataPath,
          parentNames: segment.parentNames,
          routeConfigPath: segment.routeConfigPath,
          segment: segment.name,
        });

        return [segment.name, values] as const;
      }),
    );

    return Object.fromEntries(records);
  }

  async routeDataPaths(): Promise<RouteDataFile[]> {
    const paths = await listFiles(this.config.dataPath, [".json"]);

    return Promise.all(
      paths.map(async (path) => ({
        preview: await readText(path),
        value: toPosix(relative(this.config.dataPath, path)),
      })),
    );
  }

  async checkRoutes() {
    this.routeDiscovery ??= discoverPages({
      baseRoute: this.config.baseRoute,
      cwd: this.config.cwd,
      dataPath: this.config.dataPath,
      rootPath: this.config.pagesPath,
      routeFileName: this.config.routeFileName,
    }).then(() => undefined);

    return this.routeDiscovery;
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

export const createProjectManager = ({ workspaceFolders = [] }: CreateProjectManager = {}) => {
  const workspaceRoots = workspaceFolders.map((folder) =>
    pathFromUri(typeof folder === "string" ? folder : folder.uri),
  );

  const contexts = new Map<string, ProjectContext>();

  const contextForUri = async (uri: string) => {
    const filePath = pathFromUri(uri);
    const root = await findProjectRoot({ filePath, workspaceRoots });
    const existing = contexts.get(root);

    if (existing) return existing;

    const context = new ProjectContext({
      config: await loadConfig({ cwd: root }),
      root,
    });

    contexts.set(root, context);

    return context;
  };

  return {
    contextForUri,
    invalidate: () => contexts.clear(),
  };
};

export type ProjectManager = ReturnType<typeof createProjectManager>;
