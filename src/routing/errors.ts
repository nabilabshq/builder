import { dirname, relative, resolve } from "node:path";

import type { NabiConfig, PageEntry } from "@/types";
import { fileExists } from "@/utils/files";
import { inside } from "@/utils/paths";

import { createPageEntry } from "./pages";
import { cleanRoute, mergeRouteSegments } from "./paths";

type ErrorPageForProps = {
  config: NabiConfig;
  pages: Iterable<PageEntry>;
  requested: string;
};

type ErrorPageCandidate = {
  depth: number;
  matchedSegments: number;
  page: PageEntry;
  path: string;
};

const routeSegments = (route: string) => cleanRoute(route).split("/").filter(Boolean);

const matchingSegments = (left: string, right: string) => {
  const leftSegments = routeSegments(left);
  const rightSegments = routeSegments(right);
  let length = 0;

  while (leftSegments[length] === rightSegments[length] && leftSegments[length] !== undefined) {
    length += 1;
  }

  return length;
};

const relativeRoute = (config: NabiConfig, requested: string) => {
  const route = cleanRoute(requested);
  const baseRoute = cleanRoute(config.baseRoute);

  if (!baseRoute) return route;

  if (route === baseRoute) return "";

  if (!route.startsWith(`${baseRoute}/`)) return;

  return route.slice(baseRoute.length + 1);
};

const parentDirectories = (path: string, root: string) => {
  const directories: string[] = [];
  let directory = resolve(path);
  const rootPath = resolve(root);

  while (inside(rootPath, directory)) {
    directories.push(directory);

    if (directory === rootPath) break;

    directory = dirname(directory);
  }

  return directories;
};

const routePrefix = (route: string, depth: number) => routeSegments(route).slice(0, depth).join("/");

const matchesPrefix = (route: string, prefix: string) => !prefix || route === prefix || route.startsWith(`${prefix}/`);

export const errorPageFor = async (props: ErrorPageForProps): Promise<PageEntry | undefined> => {
  const { config, pages, requested } = props;
  const route = relativeRoute(config, requested);

  if (route === undefined) return;

  const candidates: ErrorPageCandidate[] = [];

  for (const page of pages) {
    for (const directory of parentDirectories(dirname(page.path), config.pagesPath)) {
      const depth = routeSegments(relative(config.pagesPath, directory)).length;
      const prefix = routePrefix(page.route, depth);

      if (!matchesPrefix(route, prefix)) continue;

      const path = resolve(directory, `${config.errorPageFileName}.html`);

      if (!(await fileExists(path))) continue;

      candidates.push({
        depth,
        matchedSegments: matchingSegments(route, page.route),
        page,
        path,
      });
    }
  }

  const candidate = candidates.sort(
    (left, right) => right.depth - left.depth || right.matchedSegments - left.matchedSegments,
  )[0];

  if (!candidate) return;

  return createPageEntry({
    path: candidate.path,
    publicRoute: mergeRouteSegments(config.baseRoute, route),
    rootPath: config.pagesPath,
    route,
    routeContext: candidate.page.routeContext,
    routeData: candidate.page.routeData,
  });
};
