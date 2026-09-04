import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { test } from "bun:test";

import { discoverPages, fileToRoute, routeToOutput } from "@/routing";

const project = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "nabi-routing-"));

  await Promise.all(
    Object.entries(files).map(async ([path, source]) => {
      const target = join(root, path);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }),
  );

  return root;
};

const pagesFor = (root: string, routeFileName = "_route") => {
  return discoverPages({
    cwd: root,
    dataPath: join(root, "src/data"),
    rootPath: join(root, "src/pages"),
    routeFileName,
  });
};

test("keeps static route mapping", async () => {
  const root = await project({ "src/pages/about.html": "about", "src/pages/index.html": "home" });

  try {
    assert.equal(fileToRoute({ filePath: join(root, "src/pages/index.html"), rootPath: join(root, "src/pages") }), "");
    assert.equal(routeToOutput(""), "index.html");
    assert.deepEqual(
      (await pagesFor(root)).map((page) => page.route),
      ["", "about"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("uses the configured dynamic route file name", async () => {
  const root = await project({
    "src/pages/[city]/index.html": "page",
    "src/pages/[city]/routes.js": 'export default () => ({ name: "Moscow" });',
    "src/pages/[city]/routes.json": JSON.stringify(["msk"]),
  });

  try {
    const [page] = await pagesFor(root, "routes");

    assert.equal(page?.route, "msk");
    assert.deepEqual(page?.routeData, { city: { name: "Moscow" } });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("expands string arrays, data sources, local props, and empty segments", async () => {
  const root = await project({
    "src/data/global/cities.json": JSON.stringify({
      "": { name: "Россия" },
      msk: { name: "Москва" },
      spb: { name: "Санкт-Петербург" },
    }),
    "src/data/global/income.json": JSON.stringify({ msk: { income: 250000 }, spb: { income: 230000 } }),
    "src/pages/[folder]/_route.json": JSON.stringify(["perf", "rabota"]),
    "src/pages/[folder]/[city]/_route.json": JSON.stringify({
      "@data": ["global/cities.json", "global/income.json"],
      msk: { special: true },
    }),
    "src/pages/[folder]/[city]/index.html": "page",
  });

  try {
    const pages = await pagesFor(root);

    assert.deepEqual(
      pages.map((page) => page.route),
      ["perf", "perf/msk", "perf/spb", "rabota", "rabota/msk", "rabota/spb"],
    );
    assert.deepEqual(pages.find((page) => page.route === "perf/msk")?.routeData, {
      city: { income: 250000, name: "Москва", special: true },
      folder: "perf",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("filters local records with exact parent conditions", async () => {
  const root = await project({
    "src/pages/[folder]/_route.json": JSON.stringify(["perf", "rabota"]),
    "src/pages/[folder]/[city]/_route.json": JSON.stringify({ "": {}, msk: {} }),
    "src/pages/[folder]/[city]/[page]/_route.json": JSON.stringify({
      cpa: { "@when": { city: "", folder: "rabota" }, title: "CPA" },
    }),
    "src/pages/[folder]/[city]/[page]/index.html": "page",
  });

  try {
    const [page] = await pagesFor(root);

    assert.equal(page?.route, "rabota/cpa");
    assert.deepEqual(page?.routeData, { city: {}, folder: "rabota", page: { title: "CPA" } });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("filters local records with parent condition value arrays", async () => {
  const root = await project({
    "src/pages/[city]/_route.json": JSON.stringify(["msk", "spb", "ufa"]),
    "src/pages/[city]/[page]/_route.json": JSON.stringify({
      students: { "@when": { city: ["msk", "spb"] } },
    }),
    "src/pages/[city]/[page]/index.html": "page",
  });

  try {
    assert.deepEqual(
      (await pagesFor(root)).map((page) => page.route),
      ["msk/students", "spb/students"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("runs route hooks and rejects null candidates", async () => {
  const root = await project({
    "jsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    "src/data/income.json": JSON.stringify({ msk: { default: 250000, students: 200000 } }),
    "src/pages/[city]/_route.json": JSON.stringify({ "@data": "income.json" }),
    "src/pages/[city]/[page]/_route.js":
      'import income from "@/data/income.json"; export default ({ route }) => route.page === "skip" ? null : { income: income[route.city].students };',
    "src/pages/[city]/[page]/_route.json": JSON.stringify({ skip: {}, students: { title: "Students" } }),
    "src/pages/[city]/[page]/index.html": "page",
  });

  try {
    const [page] = await pagesFor(root);

    assert.equal(page?.route, "msk/students");
    assert.deepEqual(page?.routeData?.page, { income: 200000, title: "Students" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects invalid route configs and unsafe data paths", async () => {
  const root = await project({
    "src/pages/[city]/_route.json": JSON.stringify({ "@foo": "bar" }),
    "src/pages/[city]/index.html": "page",
  });

  try {
    await assert.rejects(() => pagesFor(root), /Unknown route metadata/);
    await writeFile(join(root, "src/pages/[city]/_route.json"), JSON.stringify({ "@data": "../secret.json" }));
    await assert.rejects(() => pagesFor(root), /must stay inside dataDir/);

    await Promise.all([
      mkdir(join(root, "src/pages/[city]/[page]"), { recursive: true }),
      writeFile(join(root, "src/pages/[city]/_route.json"), JSON.stringify(["msk"])),
    ]);
    await Promise.all([
      writeFile(join(root, "src/pages/[city]/[page]/_route.json"), JSON.stringify({ cpa: { "@when": { city: [] } } })),
      writeFile(join(root, "src/pages/[city]/[page]/index.html"), "page"),
    ]);
    await assert.rejects(() => pagesFor(root), /must be a valid route value or non-empty array/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reports collisions with dynamic context", async () => {
  const root = await project({
    "src/pages/[city]/_route.json": JSON.stringify(["msk", "msk"]),
    "src/pages/[city]/index.html": "page",
  });

  try {
    await assert.rejects(() => pagesFor(root), /Route collision:[\s\S]*Dynamic context: city=msk/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
