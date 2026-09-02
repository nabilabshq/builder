import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { extname } from "node:path";

import { build } from "@/builder";
import { loadConfig } from "@/config";
import type { BuiltPage, NabiConfig, NabiConfigInput } from "@/types";
import { formatError } from "@/utils/errors";
import { inside } from "@/utils/paths";

import { createLiveReload, injectReloadClient } from "./live-reload";
import { assetPathForRequest, outputFilePath, outputPathForRequest, requestPath } from "./routing";
import type { DevServerState, StartDevOptions } from "./types";
import { watchProject } from "./watcher";

type CreateRequestHandlerProps = {
  config: NabiConfig;
  state: DevServerState;
};

type ServeFileProps = {
  path: string;
  request: IncomingMessage;
  response: ServerResponse;
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

const indexPages = (pages: BuiltPage[]) => new Map(pages.map((page) => [page.publicRoute, page]));

const buildDevProject = ({ buildConfig, config }: BuildDevProjectProps) =>
  build({
    atomic: false,
    config: buildConfig,
    copyAssets: false,
    cwd: config.cwd,
    mode: "split",
  });

const serveFile = async ({ path, request, response }: ServeFileProps) => {
  try {
    const content = await readFile(path);
    const extension = extname(path).toLowerCase();

    response.writeHead(200, {
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

const createRequestHandler = ({ config, state }: CreateRequestHandlerProps) => {
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
    try {
      path = assetPathForRequest({ config, requested });
    } catch {
      response.writeHead(403).end("Forbidden");

      return;
    }

    if (!path) {
      const outputPath = outputPathForRequest({
        config,
        pages: state.pages,
        requested,
      });

      if (!outputPath) {
        response.writeHead(404).end("Not found");

        return;
      }

      path = outputFilePath(config, outputPath);

      if (!inside(config.outPath, path)) {
        response.writeHead(403).end("Forbidden");

        return;
      }
    }

    await serveFile({ path, request, response });
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

  const config = await loadConfig({
    config: {
      ...configOverrides,
      dev: {
        ...configOverrides.dev,
        ...(port !== undefined ? { port } : {}),
      },
    },
    cwd,
  });

  const buildConfig: NabiConfigInput = {
    ...configOverrides,
    minify: {
      ...configOverrides.minify,
      css: false,
      html: false,
      js: false,
    },
  };

  console.log("Building project...");

  const buildStartedAt = performance.now();
  let initialBuild: Awaited<ReturnType<typeof buildDevProject>> | undefined;

  try {
    initialBuild = await buildDevProject({ buildConfig, config });
    console.log(`Built ${initialBuild.pages.length} pages in ${displayDuration(performance.now() - buildStartedAt)}.`);
  } catch (error) {
    console.error(formatError(error));
  }

  const state: DevServerState = { pages: indexPages(initialBuild?.pages ?? []) };
  const server = createServer(createRequestHandler({ config, state }));
  const liveReload = createLiveReload(server);

  let closed = false;

  const watcher = watchProject({
    onChange: async (path) => {
      if (closed) return;

      try {
        const result = await buildDevProject({ buildConfig, config });

        state.pages = indexPages(result.pages);
        liveReload.broadcast(path.endsWith(".css") ? "css" : "reload");
      } catch (error) {
        console.error(formatError(error));
      }
    },
    path: config.srcPath,
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
