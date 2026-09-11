import type { BuiltPage, NabiConfigInput, PageEntry } from "@/types";

import type { IncrementalBuildState } from "./invalidation";

export type StartDevOptions = {
  config?: NabiConfigInput;
  cwd?: string;
  port?: number;
};

export type DevPage = {
  entry: PageEntry;
  page?: BuiltPage;
};

export type DevServerState = {
  activePages: Map<string, number>;
  errorPages: Map<string, BuiltPage>;
  incremental: IncrementalBuildState;
  pages: Map<string, DevPage>;
};
