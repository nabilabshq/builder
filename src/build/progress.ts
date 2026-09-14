import type { BuildOutputStage } from "@/build/types";
import type { BuildProgress } from "@/builder";

type Output = Pick<NodeJS.WriteStream, "isTTY" | "write">;

type BuildProgressRendererOptions = {
  output?: Output;
};

export const createBuildProgressRenderer = ({ output = process.stdout }: BuildProgressRendererOptions = {}) => {
  const startedAt = performance.now();

  let lastUpdatedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let width = 0;
  let progress: BuildProgress | undefined;
  let stageStartedAt = startedAt;

  const write = (line: string) => {
    width = Math.max(width, line.length);
    output.write(`\r${line.padEnd(width)}`);
  };

  const elapsed = () => performance.now() - startedAt;
  const stageElapsed = () => performance.now() - stageStartedAt;
  const clearTimer = () => {
    if (!timer) return;

    clearInterval(timer);
    timer = undefined;
  };

  const renderBuild = () => {
    if (!progress) return;

    const { completed, total } = progress;
    const percentage = Math.round((completed / total) * 100);
    const remaining = completed ? (elapsed() / completed) * (total - completed) : undefined;
    const eta = remaining === undefined || completed === total ? "" : ` · ETA ${displayDuration(remaining)}`;

    write(`Building ${completed}/${total} (${percentage}%) · elapsed ${displayDuration(elapsed())}${eta}`);
  };

  const startTimer = (render: () => void) => {
    clearTimer();
    stageStartedAt = performance.now();
    render();
    timer = setInterval(render, 100);
  };

  const discovering = () => {
    if (!output.isTTY) return;

    startTimer(() => write(`Discovering pages · elapsed ${displayDuration(elapsed())}`));
  };

  const begin = (nextProgress: BuildProgress) => {
    if (!output.isTTY) return;

    progress = nextProgress;
    startTimer(renderBuild);
  };

  const update = (nextProgress: BuildProgress) => {
    if (!output.isTTY) return;

    progress = nextProgress;

    const now = performance.now();

    if (nextProgress.completed < nextProgress.total && now - lastUpdatedAt < 100) {
      return;
    }

    lastUpdatedAt = now;
    renderBuild();
  };

  const outputStage = (stage: BuildOutputStage) => {
    if (!output.isTTY) return;

    const label = {
      cleaning: "Cleaning previous output",
      replacing: "Replacing output",
      writing: "Writing pages",
    }[stage];

    startTimer(() => write(`${label} · elapsed ${displayDuration(stageElapsed())}`));
  };

  const finish = () => {
    clearTimer();

    if (output.isTTY && width) {
      output.write("\n");
    }
  };

  return {
    begin,
    discovering,
    finish,
    output: outputStage,
    update,
  };
};

const displayDuration = (milliseconds: number) => {
  return milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
};
