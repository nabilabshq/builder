import type { BuildMode, BuiltPage, NabiConfig } from "@/types";

export type BuildWriteOptions = {
  atomic?: boolean;
  config: NabiConfig;
  copyAssets?: boolean;
  mode: BuildMode;
  pages: BuiltPage[];
};

export type AssetCache = {
  css: Map<string, Promise<string>>;
  js: Map<string, Promise<string>>;
};
