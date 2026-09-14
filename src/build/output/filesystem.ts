import { rename } from "node:fs/promises";
import { join, relative } from "node:path";

import type { BuildOutputStage } from "@/build/types";
import type { NabiConfig } from "@/types";
import { copyTree, listFiles, remove } from "@/utils/files";

export const temporaryPath = (config: NabiConfig) => join(config.cwd, ".nabi-build-temp");

const backupPath = (config: NabiConfig) => join(config.cwd, ".nabi-build-backup");
const retryableRenameError = (error: unknown) =>
  ["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "");

export const syncOutput = async (
  config: NabiConfig,
  temporary: string,
  onStage?: (stage: BuildOutputStage) => void,
) => {
  const expectedFiles = new Set((await listFiles(temporary)).map((path) => relative(temporary, path)));

  onStage?.("replacing");
  await copyTree(temporary, config.outPath);

  const staleFiles = (await listFiles(config.outPath)).filter(
    (path) => !expectedFiles.has(relative(config.outPath, path)),
  );

  if (staleFiles.length) {
    onStage?.("cleaning");
    await Promise.all(staleFiles.map(remove));
  }

  await remove(temporary);
};

export const replaceOutput = async (
  config: NabiConfig,
  temporary: string,
  onStage?: (stage: BuildOutputStage) => void,
) => {
  const backup = backupPath(config);

  await remove(backup);

  let oldOutputMoved = false;

  try {
    try {
      onStage?.("replacing");
      await rename(config.outPath, backup);
      oldOutputMoved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await rename(temporary, config.outPath);

    if (oldOutputMoved) {
      onStage?.("cleaning");
      await remove(backup);
    }
  } catch (error) {
    if (retryableRenameError(error)) {
      await syncOutput(config, temporary, onStage);

      if (oldOutputMoved) {
        onStage?.("cleaning");
        await remove(backup);
      }

      return;
    }

    if (oldOutputMoved) {
      try {
        await rename(backup, config.outPath);
      } catch {
        // The original output could not be restored after a failed replacement.
      }
    }

    throw error;
  }
};
