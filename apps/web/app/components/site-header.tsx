import { PRODUCT, type Account } from "@impromptu/api/contracts";
import { CircleUserIcon, MailIcon } from "lucide-react";
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
          {account?.mailboxAccess && (
            <a className={buttonVariants({ variant: "ghost" })} href="/mail/">
              <MailIcon />
              <span className="sr-only sm:not-sr-only">Mailbox</span>
            </a>
          )}
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
            <>
              <Link
                className={buttonVariants({ variant: "ghost" })}
                to="/login"
              >
                Log in
              </Link>
              <Link className={buttonVariants()} to="/register">
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
