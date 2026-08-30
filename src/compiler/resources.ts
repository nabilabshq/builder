import { dirname, join } from "node:path";

import type { Component, PageResources } from "@/types";
import { fileExists } from "@/utils/files";

import { cssModulePathsFor } from "./css-modules";

type CollectHybridResources = {
  components: Component[];
  pageModulePaths?: string[];
  pagePath: string;
  scriptPath?: string;
  stylePath?: string;
};

const unique = (paths: string[]) => [...new Set(paths)];
const existing = async (paths: string[]): Promise<string[]> => {
  const checks = await Promise.all(paths.map(async (path) => [path, await fileExists(path)] as const));

  return checks.filter(([, exists]) => exists).map(([path]) => path);
};

export const collectHybridResources = async (props: CollectHybridResources): Promise<PageResources> => {
  const {
    components,
    pageModulePaths,
    pagePath,
    scriptPath = join(dirname(pagePath), "script.js"),
    stylePath = join(dirname(pagePath), "style.css"),
  } = props;

  const componentCss = await existing(components.map((component) => component.stylePath));
  const componentJs = await existing(components.map((component) => component.scriptPath));

  const componentModules = await Promise.all(
    components.map((component) => component.cssModulePaths ?? cssModulePathsFor(component.path)),
  );

  const pageModules = pageModulePaths ?? (await cssModulePathsFor(pagePath));
  const cssModules = unique([...componentModules.flat(), ...pageModules]);

  return {
    css: unique([...componentCss, ...cssModules, ...(await existing([stylePath]))]),
    cssModules,
    js: unique([...componentJs, ...(await existing([scriptPath]))]),
  };
};
