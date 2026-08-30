import { existsSync } from "node:fs";

const huskyPath = new URL("../node_modules/husky/bin.js", import.meta.url);

if (existsSync(huskyPath)) {
  await import(huskyPath.href);
}
