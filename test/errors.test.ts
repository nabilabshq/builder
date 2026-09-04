import assert from "node:assert/strict";

import { test } from "bun:test";

import { formatError, NabiError } from "@/utils/errors.ts";

test("formats Nabi errors with a clear error heading", () => {
  const error = new NabiError('Route collision: "/partner/perf/students"\n\nDetails');

  assert.equal(formatError(error, { color: false }), '[ERROR] Route collision: "/partner/perf/students"\n\nDetails');
  assert.equal(formatError(error, { color: true }).startsWith("\u001B[31m[ERROR]\u001B[0m"), true);
});
