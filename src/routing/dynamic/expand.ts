import { matchesWhen, routeDataFor } from "./data";
import { routeHookFor, routePropsFromHook } from "./hooks";
import { dynamicSegmentName, dynamicSegmentsFor } from "./segments";
import type { DynamicPage, DynamicPageProps } from "./types";

export const expandDynamicPage = async (props: DynamicPageProps): Promise<DynamicPage[] | undefined> => {
  const { dataPath, path, rootPath, routeConfigCache, routeDataCache, routeFileName, routeHookCache } = props;

  const { dynamicSegments, routeSegments } = dynamicSegmentsFor({ path, rootPath, routeFileName });

  if (!dynamicSegments.length) return;

  let pages: DynamicPage[] = [{ context: {}, route: "", routeData: {} }];

  for (const segment of routeSegments) {
    const name = dynamicSegmentName(segment);
    const dynamic = name ? dynamicSegments.find((entry) => entry.name === name) : undefined;

    if (!dynamic) {
      pages = pages.map((page) => ({ ...page, route: [page.route, segment].filter(Boolean).join("/") }));
      continue;
    }

    const [records, hook] = await Promise.all([
      routeDataFor({
        configCache: routeConfigCache,
        dataCache: routeDataCache,
        dataPath,
        parentNames: dynamic.parentNames,
        routeConfigPath: dynamic.routeConfigPath,
        segment: dynamic.name,
      }),
      routeHookFor(dynamic.hookPath, routeHookCache),
    ]);

    const expanded: DynamicPage[] = [];

    for (const page of pages) {
      for (const record of records) {
        if (!matchesWhen(page.context, record.when)) {
          continue;
        }

        const context = { ...page.context, [dynamic.name]: record.slug };
        const hookProps = hook
          ? await routePropsFromHook(dynamic.hookPath, hook, { props: record.props, route: context })
          : {};

        if (hookProps === undefined && hook) {
          continue;
        }

        const props = { ...record.props, ...hookProps };

        expanded.push({
          context,
          route: [page.route, record.slug].filter(Boolean).join("/"),
          routeData: {
            ...page.routeData,
            [dynamic.name]: record.props === undefined && !hook ? record.slug : props,
          },
        });
      }
    }

    pages = expanded;
  }

  return pages;
};
