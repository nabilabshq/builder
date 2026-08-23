import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

import chokidar from "chokidar";
import { WebSocketServer } from "ws";

import { build } from "../builder.js";
import { loadConfig } from "../config.js";
import { requestRoute } from "../routing/pages.js";
import { inside, resolveWithin } from "../utils/paths.js";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const liveReloadClient = `<script data-nabi-live-reload>(function () {
  const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/__nabi_live_reload');
  const refreshStyles = () => {
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const url = new URL(link.href, location.href);
      url.searchParams.set('nabi', Date.now());
      const replacement = link.cloneNode();
      replacement.href = url.href;
      replacement.addEventListener('load', () => link.remove(), { once: true });
      replacement.addEventListener('error', () => replacement.remove(), { once: true });
      link.after(replacement);
    });
  };
  socket.addEventListener('message', event => {
    if (event.data !== 'css') return location.reload();
    refreshStyles();
  });
}());</script>`;

const injectReloadClient = (html) =>
  html.includes("data-nabi-live-reload") ? html : html.replace(/<\/body\s*>/i, `${liveReloadClient}</body>`);

const displayDuration = (milliseconds) => `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;

const outputPathForRequest = ({ requested, config, pages }) => {
  const route = requestRoute(requested);
  const page = pages.get(route);
  if (page) return page.outputPath;
  for (const directory of ["assets", "styles", "js"]) {
    const prefix = [config.baseRoute, directory].filter(Boolean).join("/");
    if (route === prefix || route.startsWith(`${prefix}/`)) return route;
  }
  for (const entry of pages.values()) {
    if (!entry.resources.css.length && !entry.resources.js.length) continue;
    if (route === [entry.publicRoute, "style.css"].filter(Boolean).join("/") && entry.resources.css.length)
      return [entry.outputDir, "style.css"].filter((part) => part !== ".").join("/");
    if (route === [entry.publicRoute, "script.js"].filter(Boolean).join("/") && entry.resources.js.length)
      return [entry.outputDir, "script.js"].filter((part) => part !== ".").join("/");
  }
};

const assetPathForRequest = ({ requested, config }) => {
  const route = requestRoute(requested);
  const prefix = [config.baseRoute, "assets"].filter(Boolean).join("/");
  if (!route.startsWith(`${prefix}/`)) return;
  return resolveWithin(config.assetsPath, route.slice(prefix.length + 1), "Asset");
};

export const startDev = async ({ cwd, config: configOverrides, port } = {}) => {
  const config = await loadConfig({
    cwd,
    config: { ...configOverrides, dev: { ...configOverrides?.dev, ...(port !== undefined ? { port } : {}) } },
  });
  const devBuildConfig = {
    ...configOverrides,
    minify: { ...configOverrides?.minify, html: false, css: false, js: false },
  };
  console.log("Building project...");
  const buildStartedAt = performance.now();
  let buildResult = await build({ cwd: config.cwd, config: devBuildConfig, mode: "split", copyAssets: false, atomic: false });
  console.log(`Built ${buildResult.pages.length} pages in ${displayDuration(performance.now() - buildStartedAt)}.`);
  let pages = new Map(buildResult.routes.map((page) => [page.publicRoute, page]));
  const server = createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    let requested;
    try {
      requested = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      response.writeHead(400).end("Invalid request path");
      return;
    }
    let path;
    try {
      path = assetPathForRequest({ requested, config });
    } catch {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!path) {
      const outputPath = outputPathForRequest({ requested, config, pages });
      if (!outputPath) {
        response.writeHead(404).end("Not found");
        return;
      }
      path = join(config.outPath, outputPath);
      if (!inside(config.outPath, path)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
    }
    try {
      const content = await readFile(path);
      const extension = extname(path).toLowerCase();
      response.writeHead(200, {
        "content-type": contentTypes[extension] ?? "application/octet-stream",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      response.end(
        request.method === "HEAD"
          ? undefined
          : extension === ".html"
            ? injectReloadClient(content.toString("utf8"))
            : content,
      );
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url, "http://localhost").pathname !== "/__nabi_live_reload") return socket.destroy();
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit("connection", client, request));
  });
  let closed = false;
  let queue = Promise.resolve();
  const watcher = chokidar.watch(config.srcPath, { ignoreInitial: true });
  watcher.on("all", (_, path) => {
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (closed) return;
        try {
          buildResult = await build({ cwd: config.cwd, config: devBuildConfig, mode: "split", copyAssets: false, atomic: false });
          pages = new Map(buildResult.routes.map((page) => [page.publicRoute, page]));
          const message = path.endsWith(".css") ? "css" : "reload";
          for (const client of sockets.clients) if (client.readyState === client.OPEN) client.send(message);
        } catch (error) {
          console.error(error.message);
        }
      });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.dev.port, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    closed = true;
    await watcher.close();
    throw error;
  }
  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : config.dev.port;
  return {
    url: `http://localhost:${activePort}/${config.baseRoute}`.replace(/\/$/, ""),
    close: async () => {
      if (closed) return;
      closed = true;
      await watcher.close();
      for (const client of sockets.clients) client.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
