import chokidar from "chokidar";

type WatchProjectProps = {
  onChange: (path: string) => Promise<void>;
  path: string;
};

export const watchProject = ({ onChange, path }: WatchProjectProps) => {
  const watcher = chokidar.watch(path, { ignoreInitial: true });
  let queue = Promise.resolve();

  watcher.on("all", (_event: string, changedPath: string) => {
    queue = queue.catch(() => {}).then(() => onChange(changedPath));
  });

  return watcher;
};
