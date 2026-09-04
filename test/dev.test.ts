import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { test } from "bun:test";
import { WebSocket } from "ws";

import { startDev } from "@/dev";

const findAvailablePort = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (typeof address !== "object" || address === null) {
        server.close(() => reject(new Error("Unable to determine the available port.")));

        return;
      }

      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
};

const waitForSocketOpen = (socket: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      socket.off("error", onError);
      resolve();
    };

    const onError = (error: Error) => {
      socket.off("open", onOpen);
      reject(error);
    };

    socket.once("error", onError);
    socket.once("open", onOpen);
  });

const waitForSocketMessage = (socket: WebSocket, expected: string) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for live reload message: ${expected}`));
    }, 5_000);
    const onMessage = (data: WebSocket.RawData) => {
      if (data.toString() !== expected) return;

      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve();
    };

    socket.on("message", onMessage);
  });

const waitForResponse = async (request: () => Promise<Response>) => {
  const timeout = performance.now() + 5_000;

  while (performance.now() < timeout) {
    const response = await request();

    if (response.ok) return response;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for the dev server to rebuild.");
};

test("dev server serves compiled pages and injects live reload client", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-dev-"));

  try {
    const page = join(root, "src/pages/index.html");
    const style = join(root, "src/pages/style.css");

    await mkdir(dirname(page), { recursive: true });
    await writeFile(page, "<html><body><h1>Dev page</h1></body></html>");
    await writeFile(style, "/* dev comment */\n.dev-page { color: red; }\n");

    const dev = await startDev({
      config: { minify: { css: true, html: true, js: true } },
      cwd: root,
      port: await findAvailablePort(),
    });

    try {
      const response = await fetch(dev.url);
      const html = await response.text();

      assert.equal(response.status, 200);
      assert.match(html, /Dev page/);
      assert.match(html, /data-nabi-live-reload/);
      assert.match(html, /socket\.addEventListener\('close', \(\) => setTimeout\(connect, 250\)\)/);

      const css = await (await fetch(`${dev.url}/style.css`)).text();

      assert.match(css, /dev-page/);
      assert.match(css, /dev comment/);

      const head = await fetch(dev.url, { method: "HEAD" });

      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      assert.equal((await fetch(dev.url, { method: "POST" })).status, 405);
      assert.equal((await fetch(`${dev.url}/%E0%A4%A`)).status, 400);
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("dev server maps hybrid page directories to routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-hybrid-dev-"));

  try {
    const home = join(root, "src/pages/index.html");
    const promo = join(root, "src/pages/promo/index.html");
    const about = join(root, "src/pages/about.html");
    const promoStyle = join(root, "src/pages/promo/style.css");

    await mkdir(dirname(home), { recursive: true });
    await mkdir(dirname(promo), { recursive: true });
    await mkdir(dirname(about), { recursive: true });

    const asset = join(root, "src/shared/assets/example.txt");

    await mkdir(dirname(asset), { recursive: true });
    await writeFile(home, "<html><body>Home</body></html>");
    await writeFile(promo, "<html><body>Promo</body></html>");
    await writeFile(about, "<html><body>About</body></html>");
    await writeFile(promoStyle, ".promo { color: purple; }");
    await writeFile(asset, "asset");

    const dev = await startDev({ cwd: root, port: await findAvailablePort() });

    try {
      assert.match(await (await fetch(dev.url)).text(), /Home/);
      assert.match(await (await fetch(`${dev.url}/promo`)).text(), /Promo/);
      assert.match(await (await fetch(`${dev.url}/promo/`)).text(), /Promo/);
      assert.match(await (await fetch(`${dev.url}/about?utm_source=test`)).text(), /About/);
      assert.match(await (await fetch(`${dev.url}/about/`)).text(), /About/);
      assert.match(await (await fetch(`${dev.url}/promo/style.css`)).text(), /purple/);
      assert.equal(await (await fetch(`${dev.url}/assets/example.txt`)).text(), "asset");
      await assert.rejects(() => access(join(root, "dist/assets/example.txt")));
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("dev server serves generated dynamic routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-dynamic-dev-"));

  try {
    const page = join(root, "src/pages/rabota/[city]/index.html");
    const routeData = join(root, "src/pages/rabota/[city]/_route.json");

    await mkdir(dirname(page), { recursive: true });
    await mkdir(join(root, "src/data"), { recursive: true });
    await writeFile(join(root, "src/data/cities.json"), JSON.stringify({ msk: { name: "Москва" } }));
    await writeFile(page, "<html><body>{{:city.name}}</body></html>");
    await writeFile(routeData, JSON.stringify({ "@data": "cities.json" }));

    const dev = await startDev({ cwd: root, port: await findAvailablePort() });

    try {
      assert.match(await (await fetch(`${dev.url}/rabota/msk`)).text(), /Москва/);
      assert.equal((await fetch(`${dev.url}/rabota/[city]`)).status, 404);
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("dev server stays available after an initial build error and rebuilds when it is fixed", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-dev-recovery-"));

  try {
    const page = join(root, "src/pages/[city]/index.html");
    const routeData = join(root, "src/pages/[city]/_route.json");

    await mkdir(dirname(page), { recursive: true });
    await writeFile(page, "<html><body>City</body></html>");
    await writeFile(routeData, JSON.stringify(["msk", "msk"]));

    const dev = await startDev({ cwd: root, port: await findAvailablePort() });

    try {
      assert.equal((await fetch(`${dev.url}/msk`)).status, 404);

      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(routeData, JSON.stringify(["msk"]));

      const response = await waitForResponse(() => fetch(`${dev.url}/msk`));

      assert.match(await response.text(), /City/);
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("dev server rebuilds and broadcasts CSS and full reload events", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-live-reload-"));

  try {
    const page = join(root, "src/pages/index.html");
    const style = join(root, "src/pages/style.css");

    await mkdir(dirname(page), { recursive: true });
    await writeFile(page, "<html><body>Initial</body></html>");
    await writeFile(style, ".page { color: red; }");

    const dev = await startDev({ cwd: root, port: await findAvailablePort() });
    const socket = new WebSocket(dev.url.replace("http:", "ws:") + "/__nabi_live_reload");

    try {
      await waitForSocketOpen(socket);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const cssMessage = waitForSocketMessage(socket, "css");

      await writeFile(style, ".page { color: blue; }");
      await cssMessage;

      const reloadMessage = waitForSocketMessage(socket, "reload");

      await writeFile(page, "<html><body>Updated</body></html>");
      await reloadMessage;

      assert.match(await (await fetch(dev.url)).text(), /Updated/);
    } finally {
      socket.close();
      await dev.close();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("dev server serves explicitly declared shared styles and scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-shared-dev-"));

  try {
    const page = join(root, "src/pages/index.html");
    const style = join(root, "src/shared/styles/base.css");
    const script = join(root, "src/shared/js/site.js");

    await mkdir(dirname(page), { recursive: true });
    await mkdir(dirname(style), { recursive: true });
    await mkdir(dirname(script), { recursive: true });
    await writeFile(
      page,
      '<html><head><link use="base.css"></head><body><script use="site.js"></script></body></html>',
    );
    await writeFile(style, ".shared-base { color: teal; }\n");
    await writeFile(script, "window.nabiShared = true;\n");

    const dev = await startDev({ cwd: root, port: await findAvailablePort() });

    try {
      const html = await (await fetch(dev.url)).text();

      assert.match(html, /href="\/styles\/base.css"/);
      assert.match(html, /src="\/js\/site.js"/);
      assert.match(await (await fetch(`${dev.url}/styles/base.css`)).text(), /shared-base/);
      assert.match(await (await fetch(`${dev.url}/js/site.js`)).text(), /nabiShared/);
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("dev server mounts pages and assets under configured baseRoute", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-based-dev-"));

  try {
    await writeFile(join(root, "nabi.config.js"), 'export default { baseRoute: "partner/rabota" };\n');

    const home = join(root, "src/pages/index.html");
    const students = join(root, "src/pages/students/index.html");
    const asset = join(root, "src/shared/assets/example.txt");

    await mkdir(dirname(home), { recursive: true });
    await mkdir(dirname(students), { recursive: true });
    await mkdir(dirname(asset), { recursive: true });
    await writeFile(home, "<html><body>Home</body></html>");
    await writeFile(students, "<html><body>Students</body></html>");
    await writeFile(asset, "asset");

    const dev = await startDev({ cwd: root, port: await findAvailablePort() });

    try {
      assert.match(dev.url, /\/partner\/rabota$/);
      assert.match(await (await fetch(dev.url)).text(), /Home/);
      assert.match(await (await fetch(`${dev.url}/students`)).text(), /Students/);
      assert.equal(await (await fetch(`${dev.url}/assets/example.txt`)).text(), "asset");
      assert.equal((await fetch(dev.url.replace(/\/partner\/rabota$/, "/"))).status, 404);
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
