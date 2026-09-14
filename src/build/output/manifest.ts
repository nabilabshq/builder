import { join } from "node:path";

import { writeText } from "@/utils/files";

export type BuildManifest = Record<string, { css: string[]; js: string[] }>;
export type ManifestEntry = [path: string, resources: BuildManifest[string]];

export const outputResourcePath = (directory: string, fileName: string) =>
  [directory, fileName].filter((part) => part !== ".").join("/");

export const writeManifest = async (temporary: string, entries: ManifestEntry[]) => {
  const manifest = Object.fromEntries(entries);

  await writeText(join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
};
