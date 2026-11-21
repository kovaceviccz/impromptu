import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("debates/:topicId", "routes/debate.tsx"),
  route("invite/:topicId", "routes/invite.tsx"),
  route("forgot-password", "routes/password-recovery.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("register", "routes/register.tsx"),
  route("login", "routes/login.tsx"),
  route("account", "routes/account.tsx"),
] satisfies RouteConfig;
