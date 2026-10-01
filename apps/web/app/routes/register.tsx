import {
  PRODUCT,
  firstFieldErrors,
  registerBodySchema,
} from "@impromptu/api/contracts";
import {
  type ClientActionFunctionArgs,
  Form,
  Link,
  useActionData,
  useNavigation,
} from "react-router";

import { FormField } from "~/components/form-field";
import { SiteHeader } from "~/components/site-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button, buttonVariants } from "~/components/ui/button";

import { ApiError, register } from "../api";

export function meta() {
  return [{ title: `Register · ${PRODUCT.name}` }];
}

export async function clientAction({
  request,
}: Pick<ClientActionFunctionArgs, "request">) {
  const values = Object.fromEntries(await request.formData());
  const input = registerBodySchema.safeParse(values);
  if (!input.success) {
    return {
      status: "invalid" as const,
      fieldErrors: firstFieldErrors(input.error),
      message: "",
    };
  }

  try {
    const { account } = await register(input.data);
    return { status: "created" as const, account };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return {
      status: "invalid" as const,
      fieldErrors: error.fieldErrors,
      message: Object.keys(error.fieldErrors).length === 0 ? error.message : "",
    };
  }
}

export default function Register() {
  const result = useActionData<typeof clientAction>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (result?.status === "created") {
    return (
      <>
        <SiteHeader account={result.account} />
        <main className="mx-auto grid w-full max-w-sm gap-6 px-4 py-10 sm:py-16">
          <header className="grid gap-2">
            <h1 className="font-editorial text-3xl font-semibold tracking-tight">
              Account created
            </h1>
            <output className="block text-muted-foreground">
              You are signed in as {result.account.username}.
            </output>
          </header>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link className={buttonVariants({ size: "lg" })} to="/">
              Browse debates
            </Link>
            <Link
              className={buttonVariants({ size: "lg", variant: "outline" })}
              to="/account"
            >
              View account
            </Link>
          </div>
        </main>
      </>
    );
  }

  const fieldErrors = result?.fieldErrors ?? {};

  return (
    <>
      <SiteHeader account={null} />
      <main className="mx-auto grid w-full max-w-sm gap-6 px-4 py-10 sm:py-16">
        <h1 className="font-editorial text-3xl font-semibold tracking-tight">
          Create an account
        </h1>
        <Form className="grid gap-4" method="post" noValidate>
          {result?.message ? (
            <Alert variant="destructive">
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          ) : null}
          <FormField
            autoCapitalize="none"
            autoComplete="username"
            error={fieldErrors.username}
            hint="3–30 letters, numbers, or underscores."
            label="Username"
            maxLength={30}
            name="username"
            required
          />
          <FormField
            autoComplete="email"
            error={fieldErrors.email}
            label="Email"
            name="email"
            required
            type="email"
          />
          <FormField
            autoComplete="new-password"
            error={fieldErrors.password}
            hint="At least 8 characters."
            label="Password"
            maxLength={128}
            name="password"
            required
            type="password"
          />
          <Button
            className="mt-2"
            disabled={submitting}
            size="lg"
            type="submit"
          >
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </Form>
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            className="font-medium text-primary hover:underline"
            to="/login"
          >
            Log in
          </Link>
        </p>
      </main>
    </>
  );
}
