import type { BuildMode, BuiltPage, NabiConfig } from "@/types";

export type BuildWriteOptions = {
  atomic?: boolean;
  config: NabiConfig;
  copyAssets?: boolean;
  mode: BuildMode;
  onStage?: (stage: BuildOutputStage) => void;
  pages: BuiltPage[];
};

export type BuildOutputStage = "cleaning" | "replacing" | "writing";

export type AssetCache = {
  css: Map<string, Promise<string>>;
  js: Map<string, Promise<string>>;
};
