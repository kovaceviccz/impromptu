import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("debates/:topicId", "routes/debate.tsx"),
] satisfies RouteConfig;
