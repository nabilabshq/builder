import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { test } from "bun:test";

import { discoverPages, fileToRoute, routeToOutput } from "@/routing";

const project = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "nabi-routing-"));

  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const target = join(root, path);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );

  return root;
};

test("maps index and regular HTML files to clean routes and output paths", async () => {
  const root = await project({
    "src/pages/about.html": "about",
    "src/pages/about/index.html": "about index",
    "src/pages/index.html": "home",
    "src/pages/partner/rabota/index.html": "rabota",
    "src/pages/partner/rabota/students/index.html": "students",
  });

  try {
    assert.equal(
      fileToRoute({
        filePath: join(root, "src/pages/index.html"),
        rootPath: join(root, "src/pages"),
      }),
      "",
    );
    assert.equal(routeToOutput(""), "index.html");
    await assert.rejects(
      () => discoverPages({ cwd: root, rootPath: join(root, "src/pages") }),
      /Route collision: "\/about"\n\n- src\/pages\/about.html\n- src\/pages\/about\/index.html/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("discovers nested and regular pages deterministically", async () => {
  const root = await project({
    "src/pages/@card/index.html": "component",
    "src/pages/about.html": "about",
    "src/pages/index.html": "home",
    "src/pages/partner/index.html": "partner",
    "src/pages/partner/rabota/index.html": "rabota",
    "src/pages/partner/rabota/students/index.html": "students",
  });

  try {
    const pages = await discoverPages({ cwd: root, rootPath: join(root, "src/pages") });

    assert.deepEqual(
      pages.map((page) => [page.route, page.outputPath]),
      [
        ["", "index.html"],
        ["about", "about/index.html"],
        ["partner", "partner/index.html"],
        ["partner/rabota", "partner/rabota/index.html"],
        ["partner/rabota/students", "partner/rabota/students/index.html"],
      ],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("merges an overlapping baseRoute with source directory routes", async () => {
  const root = await project({
    "src/partner/rabota/index.html": "rabota",
    "src/partner/rabota/students/index.html": "students",
    "src/shared/components/header/index.html": "component",
  });

  try {
    const pages = await discoverPages({
      baseRoute: "partner",
      cwd: root,
      ignoredPaths: [join(root, "src/shared")],
      rootPath: join(root, "src"),
    });

    assert.deepEqual(
      pages.map((page) => [page.publicRoute, page.outputPath]),
      [
        ["partner/rabota", "partner/rabota/index.html"],
        ["partner/rabota/students", "partner/rabota/students/index.html"],
      ],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
