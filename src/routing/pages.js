import { basename, dirname, extname, relative, resolve } from "node:path";

import { NabiError } from "../utils/errors.js";
import { listFiles } from "../utils/files.js";
import { inside } from "../utils/paths.js";

const toPosix = (value) => value.replaceAll("\\", "/");
const cleanRoute = (route) => route.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
const displayRoute = (route) => (route ? `/${route}` : "/");

const mergeRouteSegments = (baseRoute, route) => {
  const base = cleanRoute(baseRoute).split("/").filter(Boolean);
  const target = cleanRoute(route).split("/").filter(Boolean);
  const limit = Math.min(base.length, target.length);
  for (let length = limit; length > 0; length -= 1) {
    if (base.slice(-length).join("/") === target.slice(0, length).join("/"))
      return [...base, ...target.slice(length)].join("/");
  }
  return [...base, ...target].join("/");
};

export const fileToRoute = ({ filePath, rootPath }) => {
  const source = toPosix(relative(rootPath, filePath));
  if (!source || source.startsWith("../")) throw new NabiError(`Page is outside its source directory: ${filePath}`);
  const fileName = basename(source);
  const directory = toPosix(dirname(source));
  const route =
    fileName === "index.html"
      ? directory === "."
        ? ""
        : directory
      : [directory === "." ? "" : directory, fileName.slice(0, -extname(fileName).length)].filter(Boolean).join("/");
  return cleanRoute(route);
};

export const routeToOutput = (route) => {
  const clean = cleanRoute(route);
  return clean ? `${clean}/index.html` : "index.html";
};

const isComponentSource = ({ path, rootPath }) => toPosix(relative(rootPath, path)).split("/").includes("components");
const relativeToCwd = ({ path, cwd }) => toPosix(relative(cwd, path));

export const discoverPages = async ({ rootPath, cwd = process.cwd(), baseRoute = "", ignoredPaths = [] }) => {
  const candidates = (await listFiles(rootPath, [".html"])).filter((path) => {
    if (isComponentSource({ path, rootPath })) return false;
    return !ignoredPaths.some((ignoredPath) => inside(ignoredPath, path));
  });
  const pages = candidates.map((path) => {
    const fileName = basename(path);
    const route = fileToRoute({ filePath: path, rootPath });
    const publicRoute = mergeRouteSegments(baseRoute, route);
    const outputPath = routeToOutput(publicRoute);
    return {
      path,
      route,
      publicRoute,
      outputPath,
      outputDir: toPosix(dirname(outputPath)),
      localComponentsPath: resolve(dirname(path), "components"),
      stylePath: fileName === "index.html" ? resolve(dirname(path), "style.css") : path.replace(/\.html$/i, ".css"),
      scriptPath: fileName === "index.html" ? resolve(dirname(path), "script.js") : path.replace(/\.html$/i, ".js"),
    };
  });
  const routes = new Map();
  for (const page of pages) {
    const existing = routes.get(page.publicRoute);
    if (existing) {
      const sources = [existing, page].map((item) => `- ${relativeToCwd({ path: item.path, cwd })}`).join("\n");
      throw new NabiError(`Route collision: "${displayRoute(page.publicRoute)}"\n\n${sources}`);
    }
    routes.set(page.publicRoute, page);
  }
  return pages.sort((left, right) => left.publicRoute.localeCompare(right.publicRoute));
};

export const requestRoute = (pathname) => cleanRoute(pathname);
