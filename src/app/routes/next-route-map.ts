import { mainNav } from "./navigation";

export const nextRouteMap = [
  ...mainNav.map(({ title, url }) => ({ title, path: url })),
  { title: "Daily report (print)", path: "/reports/daily/print" },
];
