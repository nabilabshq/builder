import { basename, dirname, relative, resolve } from "node:path";

import type { PageEntry } from "@/types";
import { NabiError } from "@/utils/errors";
import { listFiles } from "@/utils/files";
import { inside } from "@/utils/paths";

import { isComponentSource, localComponentPaths } from "./components";
import { expandDynamicPage } from "./dynamic/expand";
import type { RouteDataCache } from "./dynamic/types";
import { cleanRoute, displayRoute, fileToRoute, mergeRouteSegments, routeToOutput, toPosix } from "./paths";

type DiscoverPagesOptions = {
  baseRoute?: string;
  cwd?: string;
  dataPath?: string;
  errorPageFileName?: string;
  ignoredPaths?: string[];
  includeErrorPages?: boolean;
  rootPath: string;
  routeFileName?: string;
};
type CreatePageEntryProps = {
  path: string;
  publicRoute: string;
  rootPath: string;
  route: string;
  routeContext?: PageEntry["routeContext"];
  routeData?: PageEntry["routeData"];
};

const relativeToCwd = ({ cwd, path }: { cwd: string; path: string }) => toPosix(relative(cwd, path));

const collisionSource = ({ cwd, page }: { cwd: string; page: PageEntry }) => {
  const source = `- ${relativeToCwd({ cwd, path: page.path })}`;

  if (!page.routeContext) return source;

  const context = Object.entries(page.routeContext)
    .map(([name, value]) => `${name}=${value || '""'}`)
    .join(", ");

  return `${source}\n  Dynamic context: ${context}`;
};

export const createPageEntry = async (props: CreatePageEntryProps): Promise<PageEntry> => {
  const { path, publicRoute, rootPath, route, routeContext, routeData } = props;

  const fileName = basename(path);
  const outputPath = routeToOutput(publicRoute);

  return {
    localComponentPaths: await localComponentPaths({ directory: dirname(path), rootPath }),
    outputDir: toPosix(dirname(outputPath)),
    outputPath,
    path,
    publicRoute,
    ...(routeContext ? { routeContext } : {}),
    ...(routeData ? { routeData } : {}),
    route,
    scriptPath: fileName === "index.html" ? resolve(dirname(path), "script.js") : path.replace(/\.html$/i, ".js"),
    stylePath: fileName === "index.html" ? resolve(dirname(path), "style.css") : path.replace(/\.html$/i, ".css"),
  };
};

export const discoverPages = async (props: DiscoverPagesOptions): Promise<PageEntry[]> => {
  const {
    baseRoute = "",
    cwd = process.cwd(),
    errorPageFileName = "404",
    ignoredPaths = [],
    includeErrorPages = false,
    rootPath,
    routeFileName = "_route",
  } = props;

  const dataPath = props.dataPath ?? resolve(rootPath, "..", "data");

  const candidates = (await listFiles(rootPath, [".html"])).filter((path) => {
    if (isComponentSource({ path, rootPath })) return false;

    if ((basename(path) === `${errorPageFileName}.html`) !== includeErrorPages) return false;

    return !ignoredPaths.some((ignoredPath) => inside(ignoredPath, path));
  });

  const routeDataCache: RouteDataCache = new Map();
  const routeConfigCache = new Map<string, Promise<unknown>>();
  const routeHookCache = new Map();

  const entries = await Promise.all(
    candidates.map(async (path) => {
      const dynamicPages = await expandDynamicPage({
        dataPath,
        path,
        rootPath,
        routeConfigCache,
        routeDataCache,
        routeFileName,
        routeHookCache,
      });

      if (dynamicPages === undefined) {
        const route = fileToRoute({ filePath: path, rootPath });

        return [
          createPageEntry({
            path,
            publicRoute: mergeRouteSegments(baseRoute, route),
            rootPath,
            route,
          }),
        ];
      }

      return dynamicPages.map(({ context, route, routeData }) =>
        createPageEntry({
          path,
          publicRoute: mergeRouteSegments(baseRoute, route),
          rootPath,
          route,
          routeContext: context,
          routeData,
        }),
      );
    }),
  );

  const pages = (await Promise.all(entries.flat())).flat();
  const routes = new Map<string, PageEntry>();

  for (const page of pages) {
    const existing = routes.get(page.publicRoute);

    if (existing) {
      const sources = [existing, page].map((item) => collisionSource({ cwd, page: item })).join("\n\n");

      throw new NabiError(
        `Route collision: "${displayRoute(page.publicRoute)}"\n\n` +
          `The following entries generate the same route:\n\n${sources}\n\n` +
          'Give each record a unique route slug or use "@when" to make the contexts exclusive.',
      );
    }

    routes.set(page.publicRoute, page);
  }

  return pages.sort((left, right) => left.publicRoute.localeCompare(right.publicRoute));
};

export const discoverErrorPages = async (props: DiscoverPagesOptions): Promise<PageEntry[]> => {
  const pages = await discoverPages({ ...props, includeErrorPages: true });

  return pages.map((page) => ({
    ...page,
    outputPath: `${cleanRoute(page.publicRoute)}.html`,
  }));
};
