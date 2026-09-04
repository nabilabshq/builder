import { basename, dirname, extname, relative } from "node:path";

import { NabiError } from "@/utils/errors";

type FileToRouteProps = {
  filePath: string;
  rootPath: string;
};

export const toPosix = (value: string) => value.replaceAll("\\", "/");
export const cleanRoute = (route: string) => route.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
export const displayRoute = (route: string) => (route ? `/${route}` : "/");

export const mergeRouteSegments = (baseRoute: string, route: string) => {
  const base = cleanRoute(baseRoute).split("/").filter(Boolean);
  const target = cleanRoute(route).split("/").filter(Boolean);
  const limit = Math.min(base.length, target.length);

  for (let length = limit; length > 0; length -= 1) {
    if (base.slice(-length).join("/") === target.slice(0, length).join("/")) {
      return [...base, ...target.slice(length)].join("/");
    }
  }

  return [...base, ...target].join("/");
};

export const fileToRoute = (props: FileToRouteProps) => {
  const { filePath, rootPath } = props;

  const source = toPosix(relative(rootPath, filePath));

  if (!source || source.startsWith("../")) {
    throw new NabiError(`Page is outside its source directory: ${filePath}`);
  }

  const fileName = basename(source);
  const directory = toPosix(dirname(source));
  const route =
    fileName === "index.html"
      ? directory === "."
        ? ""
        : directory
      : [directory === "." ? "" : directory, fileName.slice(0, -extname(fileName).length)].filter(Boolean).join("/");

  return cleanRoute(route);
};

export const routeToOutput = (route: string) => {
  const clean = cleanRoute(route);

  return clean ? `${clean}/index.html` : "index.html";
};

export const requestRoute = (pathname: string) => cleanRoute(pathname);
