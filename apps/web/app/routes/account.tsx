import {
  PRODUCT,
  firstFieldErrors,
  updateAccountBodySchema,
} from "@impromptu/api/contracts";
import { useState } from "react";
import {
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { FormField } from "~/components/form-field";
import { SiteHeader } from "~/components/site-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

import {
  ApiError,
  deleteAccount,
  getAccount,
  logout,
  updateAccount,
} from "../api";

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

export async function clientAction({
  request,
}: Pick<ClientActionFunctionArgs, "request">) {
  const values = Object.fromEntries(await request.formData());

  if (values.intent === "logout") {
    await logout();
    return redirect("/");
  }
  if (values.intent === "delete") {
    await deleteAccount();
    return redirect("/");
  }

  const input = updateAccountBodySchema.safeParse({
    displayName: values.displayName,
    username: values.username,
    email: values.email,
  });
  if (!input.success) {
    return {
      status: "invalid" as const,
      fieldErrors: firstFieldErrors(input.error),
      message: "",
    };
  }

  try {
    const { account } = await updateAccount(input.data);
    return {
      status: "updated" as const,
      account,
      fieldErrors: {},
      message: "",
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return {
      status: "invalid" as const,
      fieldErrors: error.fieldErrors,
      message: Object.keys(error.fieldErrors).length === 0 ? error.message : "",
    };
  }
}

export default function AccountPage() {
  const account = useLoaderData<typeof clientLoader>();
  const result = useActionData<typeof clientAction>();
  const navigation = useNavigation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const submittingIntent = navigation.formData?.get("intent");
  const fieldErrors: Record<string, string> = result?.fieldErrors ?? {};

  return (
    <>
      <SiteHeader account={account} />
      <main className="mx-auto grid w-full max-w-sm gap-8 px-4 py-10 sm:py-16">
        <header className="grid gap-2">
          <h1 className="font-editorial text-3xl font-semibold tracking-tight">
            Your account
          </h1>
          <p className="text-sm text-muted-foreground">
            Member since{" "}
            <time dateTime={account.createdAt}>
              {memberSinceFormatter.format(new Date(account.createdAt))}
            </time>
          </p>
        </header>

        <section className="grid gap-4" aria-labelledby="profile-heading">
          <h2 className="text-lg font-semibold" id="profile-heading">
            Profile
          </h2>
          <Form className="grid gap-4" method="post" noValidate>
            <input name="intent" type="hidden" value="update" />
            {result?.status === "updated" ? (
              <Alert>
                <AlertDescription>Profile updated.</AlertDescription>
              </Alert>
            ) : null}
            {result?.message ? (
              <Alert variant="destructive">
                <AlertDescription>{result.message}</AlertDescription>
              </Alert>
            ) : null}
            <FormField
              autoComplete="name"
              defaultValue={account.displayName}
              error={fieldErrors.displayName}
              hint="The name other participants will see."
              label="Display name"
              maxLength={40}
              name="displayName"
              required
            />
            <FormField
              autoCapitalize="none"
              autoComplete="username"
              defaultValue={account.username}
              error={fieldErrors.username}
              hint="3–30 letters, numbers, or underscores."
              label="Username"
              maxLength={30}
              name="username"
              required
            />
            <FormField
              autoComplete="email"
              defaultValue={account.email}
              error={fieldErrors.email}
              label="Email"
              maxLength={254}
              name="email"
              required
              type="email"
            />
            <Button
              disabled={navigation.state !== "idle"}
              size="lg"
              type="submit"
            >
              {submittingIntent === "update" ? "Saving…" : "Save changes"}
            </Button>
          </Form>
        </section>

        <section
          className="grid gap-3 border-t pt-6"
          aria-labelledby="access-heading"
        >
          <h2 className="text-lg font-semibold" id="access-heading">
            Account access
          </h2>
          <Form method="post">
            <Button
              disabled={navigation.state !== "idle"}
              name="intent"
              size="lg"
              type="submit"
              value="logout"
              variant="outline"
            >
              {submittingIntent === "logout" ? "Logging out…" : "Log out"}
            </Button>
          </Form>
        </section>

        <section
          className="grid gap-3 border-t pt-6"
          aria-labelledby="danger-heading"
        >
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold" id="danger-heading">
              Delete account
            </h2>
            <p className="text-sm text-muted-foreground">
              Permanently remove your account and end all of its sessions.
            </p>
          </div>
          <Button
            className="w-fit"
            onClick={() => setDeleteDialogOpen(true)}
            type="button"
            variant="destructive"
          >
            Delete account
          </Button>
        </section>
      </main>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="items-center sm:justify-center">
            <Button
              onClick={() => setDeleteDialogOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Form method="post">
              <Button
                disabled={navigation.state !== "idle"}
                name="intent"
                type="submit"
                value="delete"
                variant="destructive"
              >
                {submittingIntent === "delete"
                  ? "Deleting…"
                  : "Permanently delete"}
              </Button>
            </Form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
