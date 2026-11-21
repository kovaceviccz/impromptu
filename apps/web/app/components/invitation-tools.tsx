import { apiContract, type JoinResult } from "@impromptu/api/contracts";
import { useState } from "react";
import { CopyIcon, UserRoundPlusIcon } from "lucide-react";
import { ApiError, contractPost } from "~/api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
export function InvitationTools({ join }: { join: JoinResult }) {
  const [codeCopied, setCodeCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState<string>();
  const [error, setError] = useState("");
  async function share(email?: string) {
    setBusy(true);
    setMessage("");
    setError("");
    setFieldError("");
    setFallbackUrl(undefined);
    const input = apiContract.invitation.body.safeParse({
      lobbyId: join.lobbyId,
      token: join.token,
      ...(email === undefined ? {} : { email }),
    });
    if (!input.success) {
      setFieldError(
        input.error.issues.find((issue) => issue.path[0] === "email")
          ?.message ?? "Check the invitation details.",
      );
      setBusy(false);
      return;
    }
    try {
      const result = await contractPost(
        apiContract.invitation,
        input.data,
        join.topicId,
      );
      if (!email) {
        try {
          await navigator.clipboard.writeText(result.url);
        } catch {
          setFallbackUrl(result.url);
          setMessage(
            "Your browser could not copy the link. Select and copy it below.",
          );
          return;
        }
      }
      setMessage(
        email
          ? "Invitation submitted to the mailbox."
          : "Invitation link copied.",
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Invitation could not be shared.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copyCode() {
    if (!join.joinCode) return;
    try {
      await navigator.clipboard.writeText(join.joinCode);
      setCodeCopied(true);
    } catch {
      setError("Private lobby code could not be copied.");
    }
  }
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="icon-lg"
            className="size-12"
            aria-label="Invite people"
            title="Invite people"
          />
        }
      >
        <UserRoundPlusIcon className="size-5" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite participants</DialogTitle>
          <DialogDescription>
            Share a link to this lobby. Guests can choose a position or
            spectate.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-5">
          {join.isCreator && join.joinCode ? (
            <div className="grid gap-2 rounded-lg bg-secondary/60 p-3">
              <p className="text-sm text-muted-foreground">
                {join.visibility === "public"
                  ? "Public lobby code"
                  : "Private lobby code"}
              </p>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Copy lobby code ${join.joinCode}`}
                  onClick={() => void copyCode()}
                >
                  <code className="font-mono text-lg tracking-wider">
                    {join.joinCode}
                  </code>
                  <CopyIcon aria-hidden="true" />
                  {codeCopied ? "Copied" : "Copy"}
                </Button>
              </div>
              <output className="sr-only">
                {codeCopied ? "Lobby code copied." : ""}
              </output>
            </div>
          ) : null}
          {!join.joinCode && join.visibility && (
            <p className="text-sm text-muted-foreground">
              {join.visibility === "private" ? "Private lobby" : "Public lobby"}
            </p>
          )}
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void share()}
          >
            Copy invitation link
          </Button>
          {join.hostIdentity === join.participantIdentity && (
            <form
              className="grid min-w-0 gap-3 border-t border-border/60 pt-5"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const email = form.get("email");
                if (typeof email === "string") void share(email);
              }}
            >
              <label className="grid gap-1.5" htmlFor="invitation-email">
                Recipient email
                <Input
                  id="invitation-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={
                    fieldError ? "invitation-email-error" : undefined
                  }
                />
              </label>
              {fieldError && (
                <p className="text-destructive" id="invitation-email-error">
                  {fieldError}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                Send invitation
              </Button>
            </form>
          )}
          {message && <output>{message}</output>}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {fallbackUrl && (
            <>
              <label htmlFor="invitation-link">Invitation link</label>
              <Input
                id="invitation-link"
                readOnly
                value={fallbackUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
