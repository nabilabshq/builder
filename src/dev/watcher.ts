import chokidar from "chokidar";

export type WatchChange = {
  event: string;
  path: string;
};

type WatchProjectProps = {
  onChange: (changes: WatchChange[]) => Promise<void>;
  path: string | string[];
};

export const watchProject = ({ onChange, path }: WatchProjectProps) => {
  const watcher = chokidar.watch(path, { ignoreInitial: true });
  const changes = new Map<string, WatchChange>();
  let queue = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    const pendingChanges = [...changes.values()];

    changes.clear();
    queue = queue.catch(() => {}).then(() => onChange(pendingChanges));
  };

  watcher.on("all", (event: string, changedPath: string) => {
    changes.set(changedPath, { event, path: changedPath });

    if (timer) clearTimeout(timer);

    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, 25);
  });

  return watcher;
};
