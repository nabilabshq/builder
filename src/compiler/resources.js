import { dirname, join } from "node:path";

import { fileExists } from "../utils/files.js";
import { cssModulePathsFor } from "./css-modules.js";

const unique = (paths) => [...new Set(paths)];

const existing = async (paths) =>
  (await Promise.all(paths.map(async (path) => ((await fileExists(path)) ? path : undefined)))).filter(Boolean);

export const collectHybridResources = async ({
  pagePath,
  stylePath = join(dirname(pagePath), "style.css"),
  scriptPath = join(dirname(pagePath), "script.js"),
  components,
}) => {
  const componentCss = await existing(components.map((component) => component.stylePath));
  const componentJs = await existing(components.map((component) => component.scriptPath));
  const componentModules = await Promise.all(components.map((component) => cssModulePathsFor(component.path)));
  const pageModules = await cssModulePathsFor(pagePath);
  const cssModules = unique([...componentModules.flat(), ...pageModules]);
  return {
    css: unique([...componentCss, ...cssModules, ...(await existing([stylePath]))]),
    cssModules,
    js: unique([...componentJs, ...(await existing([scriptPath]))]),
  };
};
