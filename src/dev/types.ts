import type { BuiltPage, NabiConfigInput } from "@/types";

export type StartDevOptions = {
  config?: NabiConfigInput;
  cwd?: string;
  port?: number;
};

export type DevServerState = { pages: Map<string, BuiltPage> };
