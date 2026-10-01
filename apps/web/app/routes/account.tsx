import { PRODUCT } from "@impromptu/api/contracts";
import {
  type ClientLoaderFunctionArgs,
  Form,
  redirect,
  useLoaderData,
  useNavigation,
} from "react-router";

import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";

import { ApiError, getAccount, logout } from "../api";

const memberSinceFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "long",
});

export function meta() {
  return [{ title: `Account · ${PRODUCT.name}` }];
}

export async function clientLoader({
  request,
}: Pick<ClientLoaderFunctionArgs, "request">) {
  try {
    const { account } = await getAccount();
    return account;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const { pathname, search } = new URL(request.url);
      throw redirect(
        `/login?${new URLSearchParams({ redirectTo: pathname + search })}`,
      );
    }
    throw error;
  }
}

export async function clientAction() {
  await logout();
  return redirect("/");
}

export default function AccountPage() {
  const account = useLoaderData<typeof clientLoader>();
  const navigation = useNavigation();

  return (
    <>
      <SiteHeader account={account} />
      <main className="mx-auto grid w-full max-w-sm gap-6 px-4 py-10 sm:py-16">
        <h1 className="font-editorial text-3xl font-semibold tracking-tight">
          Your account
        </h1>
        <dl className="grid gap-4">
          <div>
            <dt className="text-xs text-muted-foreground">Username</dt>
            <dd className="font-medium">{account.username}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="font-medium break-all">{account.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Member since</dt>
            <dd className="font-medium">
              <time dateTime={account.createdAt}>
                {memberSinceFormatter.format(new Date(account.createdAt))}
              </time>
            </dd>
          </div>
        </dl>
        <Form method="post">
          <Button
            disabled={navigation.state !== "idle"}
            size="lg"
            type="submit"
            variant="destructive"
          >
            Log out
          </Button>
        </Form>
      </main>
    </>
  );
}
