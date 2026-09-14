import assert from "node:assert/strict";

import { test } from "bun:test";

import { createBuildProgressRenderer } from "@/build/progress";

test("build progress renders initial, output stages, and interrupted final state for TTY output", () => {
  const writes: string[] = [];
  const output = {
    isTTY: true,
    write: (value: string) => {
      writes.push(value);

      return true;
    },
  };
  const progress = createBuildProgressRenderer({ output });

  progress.discovering();
  progress.begin({ completed: 0, total: 2 });
  progress.update({ completed: 2, total: 2 });
  progress.output("writing");
  progress.output("replacing");
  progress.output("cleaning");
  progress.finish();

  assert.match(writes[0] ?? "", /Discovering pages/);
  assert.match(writes[1] ?? "", /Building 0\/2 \(0%\)/);
  assert.match(writes[2] ?? "", /Building 2\/2 \(100%\)/);
  assert.match(writes[3] ?? "", /Writing pages/);
  assert.match(writes[4] ?? "", /Replacing output/);
  assert.match(writes[5] ?? "", /Cleaning previous output/);
  assert.equal(writes.at(-1), "\n");
});

test("build progress remains silent for non-TTY output", () => {
  const writes: string[] = [];
  const output = {
    isTTY: false,
    write: (value: string) => {
      writes.push(value);

      return true;
    },
  };
  const progress = createBuildProgressRenderer({ output });

  progress.discovering();
  progress.begin({ completed: 0, total: 1 });
  progress.update({ completed: 1, total: 1 });
  progress.output("writing");
  progress.finish();

  assert.deepEqual(writes, []);
});
