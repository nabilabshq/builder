import type { BuiltPage } from "@/types";

export const createManifest = (pages: BuiltPage[]) =>
  Object.fromEntries(pages.map((page) => [page.outputPath, page.dependencies]));
