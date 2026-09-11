import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { basename, extname, join, relative } from "node:path";

import { writeDevPage } from "@/build/output";
import { build, buildDevPage, discoverPages } from "@/builder";
import { loadConfig } from "@/config";
import { errorPageFor, requestRoute } from "@/routing";
import type { BuiltPage, NabiConfig, NabiConfigInput } from "@/types";
import { formatError } from "@/utils/errors";
import { remove } from "@/utils/files";
import { inside } from "@/utils/paths";

import {
  createIncrementalBuildState,
  invalidateDependency,
  invalidatePages,
  removePage,
  replacePageDependencies,
} from "./invalidation";
import { createLiveReload, injectReloadClient } from "./live-reload";
import { assetPathForRequest, outputFilePath, outputPathForRequest, requestPath } from "./routing";
import type { DevServerState, StartDevOptions } from "./types";
import { watchProject } from "./watcher";

type CreateRequestHandlerProps = {
  getConfig: () => NabiConfig;
  rebuildErrorPage: (route: string) => Promise<BuiltPage | undefined>;
  rebuildPage: (route: string) => Promise<void>;
  state: DevServerState;
};

type ServeFileProps = {
  path: string;
  request: IncomingMessage;
  response: ServerResponse;
  status?: number;
};

type BuildDevProjectProps = {
  buildConfig: NabiConfigInput;
  config: NabiConfig;
};

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const displayDuration = (milliseconds: number) => `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;

const indexPages = (pages: BuiltPage[]) => new Map(pages.map((page) => [page.publicRoute, { entry: page, page }]));

const builtPages = (pages: DevServerState["pages"]) => {
  return new Map([...pages].flatMap(([route, value]) => (value.page ? [[route, value.page] as const] : [])));
};

const outputPages = (state: DevServerState) => new Map([...builtPages(state.pages), ...state.errorPages]);

const isRouteStructurePath = (config: NabiConfig, path: string) => {
  const name = basename(path);

  return (
    inside(config.dataPath, path) || name === `${config.routeFileName}.json` || name === `${config.routeFileName}.js`
  );
};

const buildDevProject = ({ buildConfig, config }: BuildDevProjectProps) =>
  build({
    atomic: false,
    config: buildConfig,
    copyAssets: false,
    cwd: config.cwd,
    mode: "split",
  });

const serveFile = async ({ path, request, response, status = 200 }: ServeFileProps) => {
  try {
    const content = await readFile(path);
    const extension = extname(path).toLowerCase();

    response.writeHead(status, {
      "cache-control": "no-cache",
      "content-type": contentTypes[extension] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    response.end(
      request.method === "HEAD"
        ? undefined
        : extension === ".html"
          ? injectReloadClient(content.toString("utf8"))
          : content,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      response.writeHead(404).end("Not found");

      return;
    }

    console.error(error);
    response.writeHead(500).end("Internal server error");
  }
};

const createRequestHandler = ({ getConfig, rebuildErrorPage, rebuildPage, state }: CreateRequestHandlerProps) => {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { allow: "GET, HEAD" }).end("Method not allowed");

      return;
    }

    const requested = requestPath(request.url);

    if (!requested) {
      response.writeHead(400).end("Invalid request path");

      return;
    }

    let path: string | undefined;
    let status = 200;
    const config = getConfig();

    try {
      path = assetPathForRequest({ config, requested });
    } catch {
      response.writeHead(403).end("Forbidden");

      return;
    }

    if (!path) {
      const route = requestRoute(requested);
      const page = state.pages.get(route);

      if (page && (!page.page || state.incremental.dirtyPages.has(route))) {
        try {
          await rebuildPage(route);
        } catch (error) {
          console.error(formatError(error));
          response.writeHead(500).end("Unable to rebuild page");

          return;
        }
      }

      const outputPath = outputPathForRequest({
        config,
        pages: outputPages(state),
        requested,
      });

      if (!outputPath) {
        let errorPage: BuiltPage | undefined;

        try {
          errorPage = await rebuildErrorPage(route);
        } catch (error) {
          console.error(formatError(error));
          response.writeHead(500).end("Unable to build error page");

          return;
        }

        if (!errorPage) {
          response.writeHead(404).end("Not found");

          return;
        }

        path = outputFilePath(config, errorPage.outputPath);
        status = 404;
      } else {
        path = outputFilePath(config, outputPath);
      }

      if (!inside(config.outPath, path)) {
        response.writeHead(403).end("Forbidden");

        return;
      }
    }

    await serveFile({ path, request, response, status });
  };
};

const listen = (server: ReturnType<typeof createServer>, port: number) =>
  new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });

const closeServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") return resolve();

      reject(error);
    });
  });

export const startDev = async (options: StartDevOptions = {}) => {
  const { config: configOverrides = {}, cwd, port } = options;

  const configOverridesWithPort: NabiConfigInput = {
    ...configOverrides,
    dev: {
      ...configOverrides.dev,
      ...(port !== undefined ? { port } : {}),
    },
  };

  const buildConfig: NabiConfigInput = {
    ...configOverridesWithPort,
    minify: {
      ...configOverrides.minify,
      css: false,
      html: false,
      js: false,
    },
  };

  let config = await loadConfig({ config: buildConfig, cwd });
  const configPath = join(config.cwd, "nabi.config.js");

  console.log("Building project...");

  const buildStartedAt = performance.now();
  let initialBuild: Awaited<ReturnType<typeof buildDevProject>> | undefined;

  try {
    initialBuild = await buildDevProject({ buildConfig, config });
    console.log(`Built ${initialBuild.pages.length} pages in ${displayDuration(performance.now() - buildStartedAt)}.`);
  } catch (error) {
    console.error(formatError(error));
  }

  const state: DevServerState = {
    activePages: new Map(),
    errorPages: new Map(),
    incremental: createIncrementalBuildState(initialBuild?.pages ?? []),
    pages: indexPages(initialBuild?.pages ?? []),
  };

  let projectRebuild: Promise<void> | undefined;

  const rebuildProject = async () => {
    if (projectRebuild) return projectRebuild;

    projectRebuild = (async () => {
      const startedAt = performance.now();

      config = await loadConfig({ config: buildConfig, cwd });
      const result = await buildDevProject({ buildConfig, config });

      state.pages = indexPages(result.pages);
      state.errorPages.clear();
      state.incremental = createIncrementalBuildState(result.pages);
      console.log(`Built ${result.pages.length} pages in ${displayDuration(performance.now() - startedAt)}.`);
    })();

    try {
      await projectRebuild;
    } finally {
      projectRebuild = undefined;
    }
  };

  const rebuildPage = async (route: string, resourcesOnly = false) => {
    const existing = state.incremental.rebuildingPages.get(route);

    if (existing) return existing;

    const rebuilding = (async () => {
      const startedAt = performance.now();

      while (state.incremental.dirtyPages.has(route)) {
        const generation = state.incremental.generations.get(route);
        const current = state.pages.get(route);
        const entry = current?.entry;

        if (!entry) {
          state.incremental.dirtyPages.delete(route);

          return;
        }

        const page = resourcesOnly && current.page ? current.page : await buildDevPage({ config, entry });

        await writeDevPage({ config, page });

        if (!resourcesOnly) {
          state.pages.set(route, { entry: page, page });
          replacePageDependencies(state.incremental, page);
        }

        if (generation === state.incremental.generations.get(route)) {
          state.incremental.dirtyPages.delete(route);
        }
      }

      const action = resourcesOnly ? "Updated CSS for" : "Rebuilt";

      console.log(`${action} /${route || ""} in ${displayDuration(performance.now() - startedAt)}.`);
    })();

    state.incremental.rebuildingPages.set(route, rebuilding);

    try {
      await rebuilding;
    } finally {
      state.incremental.rebuildingPages.delete(route);
    }
  };

  const rebuildErrorPage = async (route: string) => {
    const entry = await errorPageFor({
      config,
      pages: [...state.pages.values()].map((page) => page.entry),
      requested: route,
    });

    if (!entry) return;

    const page = await buildDevPage({ config, entry });

    await writeDevPage({ config, page });
    state.errorPages.set(route, page);

    return page;
  };

  const server = createServer(
    createRequestHandler({
      getConfig: () => config,
      rebuildErrorPage,
      rebuildPage,
      state,
    }),
  );

  const liveReload = createLiveReload({
    onRouteActive: (path) => {
      const route = requestRoute(path);

      if (!state.pages.has(route)) return;

      state.activePages.set(route, (state.activePages.get(route) ?? 0) + 1);
    },
    onRouteInactive: (path) => {
      const route = requestRoute(path);
      const count = state.activePages.get(route);

      if (!count || count === 1) {
        state.activePages.delete(route);
      } else {
        state.activePages.set(route, count - 1);
      }
    },
    server,
  });

  let closed = false;

  const watcher = watchProject({
    onChange: async (changes) => {
      if (closed) return;

      try {
        const paths = changes.map((change) => change.path);

        state.errorPages.clear();

        if (paths.includes(configPath)) {
          await rebuildProject();
          liveReload.broadcast("reload");

          return;
        }

        const deletedPageRoutes = changes.flatMap((change) => {
          if (change.event !== "unlink") return [];

          return [...state.pages].filter(([, page]) => page.entry.path === change.path).map(([route]) => route);
        });

        for (const route of deletedPageRoutes) {
          const page = state.pages.get(route);

          if (!page) continue;

          state.activePages.delete(route);
          state.pages.delete(route);
          removePage(state.incremental, route);
          await remove(join(config.outPath, page.entry.outputPath));
        }

        if (paths.some((path) => isRouteStructurePath(config, path))) {
          const entries = await discoverPages(config);
          const previousPages = state.pages;
          const nextPages = new Map(
            entries.map((entry) => {
              const previous = previousPages.get(entry.publicRoute);

              return [entry.publicRoute, { entry, ...(previous?.page ? { page: previous.page } : {}) }];
            }),
          );
          const removedRoutes = [...previousPages.keys()].filter((route) => !nextPages.has(route));

          for (const route of removedRoutes) {
            const page = previousPages.get(route);

            if (page) {
              await remove(join(config.outPath, page.entry.outputPath));
            }

            state.activePages.delete(route);
            removePage(state.incremental, route);
          }

          state.pages = nextPages;

          const dirtyRoutes = [...nextPages].flatMap(([route, page]) => {
            const previous = previousPages.get(route);

            return !previous || page.entry.routeContext ? [route] : [];
          });

          const affected = invalidatePages(state.incremental, dirtyRoutes);
          const active = [...affected].filter((route) => state.activePages.has(route));

          await Promise.all(active.map((route) => rebuildPage(route)));
          liveReload.broadcast("reload");

          return;
        }

        const affected = new Set(paths.flatMap((path) => [...invalidateDependency(state.incremental, path)]));

        if (!affected.size && !deletedPageRoutes.length && paths.some((path) => path.endsWith(".html"))) {
          await rebuildProject();
          liveReload.broadcast("reload");

          return;
        }

        const active = [...affected].filter((route) => state.activePages.has(route));
        const resourcesOnly = paths.every((path) => path.endsWith(".css"));

        await Promise.all(active.map((route) => rebuildPage(route, resourcesOnly)));

        if (affected.size) {
          const pending = affected.size - active.length;
          const changed = paths.map((path) => relative(config.cwd, path)).join(", ");
          const rebuilt = active.length
            ? ` Rebuilt ${active.length} active page${active.length === 1 ? "" : "s"}.`
            : "";

          console.log(
            `Changed ${changed}. Invalidated ${affected.size} page${affected.size === 1 ? "" : "s"}.${rebuilt}`,
          );

          if (pending) {
            console.log(`${pending} page${pending === 1 ? " is" : "s are"} pending lazy rebuild.`);
          }
        }

        liveReload.broadcast(resourcesOnly ? "css" : "reload");
      } catch (error) {
        console.error(formatError(error));
      }
    },
    path: [config.srcPath, configPath],
  });

  try {
    await listen(server, config.dev.port);
  } catch (error) {
    closed = true;
    await watcher.close();
    throw error;
  }

  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : config.dev.port;

  return {
    close: async () => {
      if (closed) return;

      closed = true;
      await watcher.close();
      liveReload.close();
      server.closeAllConnections();
      await closeServer(server);
    },
    url: `http://localhost:${activePort}/${config.baseRoute}`.replace(/\/$/, ""),
  };
};
