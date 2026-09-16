import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";

import { Spinner } from "~/components/ui/spinner";

import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-svh bg-background text-foreground antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback() {
  return (
    <main className="grid min-h-svh place-content-center text-muted-foreground">
      <Spinner className="size-6" />
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText
    : error instanceof Error
      ? error.message
      : "Something went wrong";

  return (
    <main className="mx-auto max-w-xl p-6 sm:py-12">
      <h1 className="font-editorial text-3xl font-semibold">
        Unable to load the application
      </h1>
      <p className="mt-3 text-muted-foreground">{message}</p>
    </main>
  );
}

export default function App() {
  return <Outlet />;
}
