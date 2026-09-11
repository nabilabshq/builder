import { mkdir } from "node:fs/promises";

import type { BuildWriteOptions } from "@/build/types";
import { remove } from "@/utils/files";

import { replaceOutput, syncOutput, temporaryPath } from "./filesystem";
import { writeHybridBuild } from "./write";

export { writeDevPage } from "./write";

export const writeBuild = async ({ atomic = true, config, copyAssets = true, mode, pages }: BuildWriteOptions) => {
  const temporary = temporaryPath(config);

  await remove(temporary);
  await mkdir(temporary, { recursive: true });

  try {
    await writeHybridBuild({ config, copyAssets, mode, pages, temporary });

    if (atomic) {
      await replaceOutput(config, temporary);
    } else {
      await syncOutput(config, temporary);
    }
  } catch (error) {
    await remove(temporary);

    throw error;
  }
};
