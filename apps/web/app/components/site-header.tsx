import { PRODUCT, type Account } from "@impromptu/api/contracts";
import { CircleUserIcon } from "lucide-react";
import { Link } from "react-router";

import { buttonVariants } from "~/components/ui/button";

export function SiteHeader({ account }: { account: Account | null }) {
  return (
    <header className="bg-[#f8fafc]">
      <div className="mx-auto flex h-14 w-full min-w-0 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          className="shrink-0 font-editorial text-xl font-semibold tracking-tight text-primary"
          to="/"
        >
          {PRODUCT.name}
        </Link>
        <nav
          aria-label="Account"
          className="flex min-w-0 items-center gap-1 sm:gap-2"
        >
          {account ? (
            <Link
              className={buttonVariants({
                variant: "ghost",
                className: "min-w-0 shrink",
              })}
              to="/account"
            >
              <CircleUserIcon />
              <span className="truncate">{account.displayName}</span>
            </Link>
          ) : (
            <Link
              className="inline-flex min-h-10 items-center rounded-sm px-2 text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              to="/login"
            >
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
