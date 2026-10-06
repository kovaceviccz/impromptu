import { PRODUCT } from "@impromptu/api/contracts";
import { Link } from "react-router";

import { PublicLobbyBrowser } from "~/components/public-lobby-browser";

import { getPublicLobbies } from "../api";

export function meta() {
  return [
    { title: `Public lobbies | ${PRODUCT.name}` },
    {
      name: "description",
      content: "Browse public debate lobbies.",
    },
  ];
}

export default function PublicLobbies() {
  return (
    <main className="min-h-svh bg-background">
      <header className="bg-[#f8fafc]">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link
            className="font-editorial text-xl font-semibold tracking-tight text-primary"
            to="/"
          >
            {PRODUCT.name}
          </Link>
          <span className="text-sm text-muted-foreground">Public lobbies</span>
        </div>
      </header>
      <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="font-editorial mb-4 text-3xl font-semibold">
          Browse public lobbies
        </h1>
        <PublicLobbyBrowser loadLobbies={getPublicLobbies} />
      </section>
    </main>
  );
}
