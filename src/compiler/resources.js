import { dirname, join } from "node:path";

import { fileExists } from "../utils/files.js";

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
  return {
    css: unique([...componentCss, ...(await existing([stylePath]))]),
    js: unique([...componentJs, ...(await existing([scriptPath]))]),
  };
};
