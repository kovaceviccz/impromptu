import {
  PRODUCT,
  firstFieldErrors,
  loginBodySchema,
} from "@impromptu/api/contracts";
import {
  type ClientActionFunctionArgs,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";

import { FormField } from "~/components/form-field";
import { SiteHeader } from "~/components/site-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

import { ApiError, login } from "../api";
import { safeRedirect } from "../safe-redirect";

export { safeRedirect } from "../safe-redirect";

export function meta() {
  return [{ title: `Log in · ${PRODUCT.name}` }];
}

export async function clientAction({
  request,
}: Pick<ClientActionFunctionArgs, "request">) {
  const { redirectTo, ...values } = Object.fromEntries(
    await request.formData(),
  );
  const input = loginBodySchema.safeParse(values);
  if (!input.success) {
    return { fieldErrors: firstFieldErrors(input.error), message: "" };
  }

  try {
    await login(input.data);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { fieldErrors: error.fieldErrors, message: error.message };
  }
  return redirect(safeRedirect(redirectTo ?? null));
}

export default function Login() {
  const result = useActionData<typeof clientAction>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const fieldErrors = result?.fieldErrors ?? {};
  const redirectTo = searchParams.get("redirectTo");

  return (
    <>
      <SiteHeader account={null} />
      <main className="mx-auto grid w-full max-w-sm gap-6 px-4 py-10 sm:py-16">
        <h1 className="font-editorial text-3xl font-semibold tracking-tight">
          Log in
        </h1>
        <Form className="grid gap-4" method="post" noValidate>
          {result?.message && Object.keys(fieldErrors).length === 0 ? (
            <Alert variant="destructive">
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          ) : null}
          {redirectTo ? (
            <input name="redirectTo" type="hidden" value={redirectTo} />
          ) : null}
          <FormField
            autoCapitalize="none"
            autoComplete="username"
            error={fieldErrors.identifier}
            label="Username or email"
            name="identifier"
            required
          />
          <FormField
            autoComplete="current-password"
            error={fieldErrors.password}
            label="Password"
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
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </Form>
        <p className="text-sm text-muted-foreground">
          New to {PRODUCT.name}?{" "}
          <Link
            className="font-medium text-primary hover:underline"
            to="/register"
          >
            Create an account
          </Link>
        </p>
      </main>
    </>
  );
}
