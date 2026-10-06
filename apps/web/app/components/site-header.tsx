import { PRODUCT, type Account } from "@impromptu/api/contracts";
import { CircleUserIcon } from "lucide-react";
import { Link } from "react-router";

import { buttonVariants } from "~/components/ui/button";

export function SiteHeader({ account }: { account: Account | null }) {
  return (
    <header className="bg-[#f8fafc]">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          className="font-editorial text-xl font-semibold tracking-tight text-primary"
          to="/"
        >
          {PRODUCT.name}
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          {account ? (
            <Link
              className={buttonVariants({ variant: "ghost" })}
              to="/account"
            >
              <CircleUserIcon />
              {account.username}
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
