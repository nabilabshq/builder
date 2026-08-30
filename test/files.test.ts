import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "bun:test";

import { fileExists } from "@/utils/files.ts";

test("fileExists returns false only for missing paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-files-"));

  try {
    assert.equal(await fileExists(join(root, "missing")), false);
    await assert.rejects(() => fileExists("\0"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
