import { notFound } from "next/navigation";
import { nextRouteMap } from "./routes/next-route-map";
import { RouteIntegrationGate } from "./route-integration-gate";

export function RouteIntegrationPage({ path }: { path: string }) {
  const route = nextRouteMap.find((item) => item.path === path);

  if (!route) {
    notFound();
  }

  return <RouteIntegrationGate routeTitle={route.title} />;
}
