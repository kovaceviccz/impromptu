import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("lobbies", "routes/lobbies.tsx"),
  route("debates/:topicId", "routes/debate.tsx"),
  route("register", "routes/register.tsx"),
  route("login", "routes/login.tsx"),
  route("account", "routes/account.tsx"),
] satisfies RouteConfig;
