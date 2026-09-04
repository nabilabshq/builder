import type { RouteData } from "@/types";

type InterpolateRouteDataProps = {
  routeContext?: Record<string, string>;
  routeData?: Record<string, RouteData | string>;
  source: string;
};

export const interpolateRouteData = (props: InterpolateRouteDataProps) => {
  const { routeContext, routeData, source } = props;

  if (!routeData) return source;

  return source.replace(/{{:([\w.-]+)}}/g, (placeholder, expression: string) => {
    const [segment, ...properties] = expression.split(".");

    if (properties.length === 0 && routeContext && Object.hasOwn(routeContext, segment)) {
      return routeContext[segment];
    }

    const value = [segment, ...properties].reduce<unknown>((current, key) => {
      if (typeof current === "object" && current !== null && Object.hasOwn(current, key)) {
        return (current as Record<string, unknown>)[key];
      }

      return undefined;
    }, routeData);

    return value === undefined || typeof value === "object" ? placeholder : String(value);
  });
};
