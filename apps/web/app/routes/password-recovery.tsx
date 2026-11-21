import {
  apiContract,
  firstFieldErrors,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
} from "@impromptu/api/contracts";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError, contractPost } from "~/api";
import { SiteHeader } from "~/components/site-header";
import { FormField } from "~/components/form-field";
import { Button } from "~/components/ui/button";
import { Alert, AlertDescription } from "~/components/ui/alert";

export default function PasswordRecovery() {
  const navigate = useNavigate();
  const reset = useLocation().pathname === "/reset-password";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <SiteHeader account={null} />
      <main className="mx-auto grid max-w-md gap-6 px-4 py-10 sm:py-16">
        <h1 className="font-editorial text-3xl font-semibold tracking-tight">
          {reset ? "Reset password" : "Forgot password"}
        </h1>
        {message &&
          (failed ? (
            <Alert variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : (
            <output>{message}</output>
          ))}
        {!done && (
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const values = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              const parsed = reset
                ? resetPasswordBodySchema.safeParse({
                    ...values,
                    token:
                      new URLSearchParams(window.location.hash.slice(1)).get(
                        "token",
                      ) ?? "",
                  })
                : forgotPasswordBodySchema.safeParse(values);
              setErrors({});
              setMessage("");
              setFailed(false);
              if (!parsed.success) {
                setFailed(true);
                setErrors(firstFieldErrors(parsed.error));
                if (
                  parsed.error.issues.some((issue) => issue.path[0] === "token")
                )
                  setMessage("This reset link is invalid. Request a new link.");
                return;
              }
              setBusy(true);
              void contractPost(
                reset ? apiContract.resetPassword : apiContract.forgotPassword,
                parsed.data,
              )
                .then(
                  () => {
                    setDone(true);
                    setMessage(
                      reset
                        ? "Password changed. You can now log in."
                        : "If an eligible account exists, a password reset email has been submitted.",
                    );
                    if (reset)
                      void navigate("/login?passwordReset=1", {
                        replace: true,
                      });
                  },
                  (cause: unknown) => {
                    setFailed(true);
                    if (cause instanceof ApiError) setErrors(cause.fieldErrors);
                    setMessage(
                      cause instanceof ApiError
                        ? cause.message
                        : "The request could not be completed. Try again.",
                    );
                  },
                )
                .finally(() => setBusy(false));
            }}
          >
            {reset ? (
              <>
                <FormField
                  name="password"
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  error={errors.password}
                />
                <FormField
                  name="confirmPassword"
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  error={errors.confirmPassword}
                />
              </>
            ) : (
              <FormField
                name="email"
                label="Email"
                type="email"
                autoComplete="email"
                error={errors.email}
              />
            )}
            <Button type="submit" disabled={busy}>
              {busy
                ? "Submitting…"
                : reset
                  ? "Change password"
                  : "Request reset link"}
            </Button>
          </form>
        )}
        <Link className="text-primary underline" to="/login">
          Log in
        </Link>
        {reset && <Link to="/forgot-password">Request a new reset link</Link>}
      </main>
    </>
  );
}
