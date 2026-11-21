import {
  apiContract,
  type PrivateLobbyPreview,
} from "@impromptu/api/contracts";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ApiError, contractPost, joinTopic } from "~/api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SiteHeader } from "~/components/site-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { rememberRoom } from "~/room-session";

export default function InvitationPage() {
  const { topicId } = useParams();
  const { hash } = useLocation();
  const invitation = new URLSearchParams(hash.slice(1)).get("invitation") ?? "";
  return (
    <InvitationDetails
      key={`${topicId}:${invitation}`}
      topicId={topicId}
      invitation={invitation}
    />
  );
}

function InvitationDetails({
  topicId,
  invitation,
}: {
  topicId?: string;
  invitation: string;
}) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<PrivateLobbyPreview>();
  const [name, setName] = useState("");
  const [side, setSide] = useState<0 | 1>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void contractPost(
      apiContract.invitationPreview,
      { invitation },
      topicId,
    ).then(
      (value) => {
        if (active) setPreview(value);
      },
      () => {
        if (active)
          setError(
            "This invitation is invalid, expired, or its lobby has closed.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [invitation, topicId]);
  async function join(spectate: boolean) {
    if (!topicId || (!spectate && (side === undefined || !name.trim()))) return;
    setBusy(true);
    setError("");
    try {
      const result = await joinTopic(
        topicId,
        spectate
          ? { intent: "spectator", invitation }
          : {
              intent: "debater",
              sideIndex: side!,
              displayName: name,
              invitation,
            },
      );
      if ("code" in result) {
        setError(result.message);
        return;
      }
      rememberRoom(result);
      await navigate(`/debates/${encodeURIComponent(topicId)}`, {
        state: { joinResult: result },
      });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to join this lobby. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SiteHeader account={null} />
      <main className="mx-auto grid max-w-3xl gap-6 px-4 py-10 sm:px-6 sm:py-16">
        {error && (
          <>
            {!preview && (
              <h1 className="font-editorial text-3xl">
                Invitation unavailable
              </h1>
            )}
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </>
        )}
        {preview ? (
          <>
            <h1 className="font-editorial text-3xl [overflow-wrap:anywhere]">
              {preview.title}
            </h1>
            <p>
              No account is required. Choose an available position or spectate.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {preview.sides.map((position, index) => (
                <div
                  className={
                    "grid min-w-0 grid-rows-[1fr_auto_auto] gap-3 rounded-lg p-3 sm:p-5 " +
                    (index === 0
                      ? "bg-emerald-50 text-emerald-900"
                      : "bg-red-50 text-red-900")
                  }
                  key={position}
                >
                  <h2 className="font-editorial text-xl leading-snug font-semibold [overflow-wrap:anywhere]">
                    {position}
                  </h2>
                  <p>
                    {preview.sideAvailability[index]
                      ? "Available"
                      : "Unavailable"}
                  </p>
                  <Button
                    className="h-auto min-h-10 w-full min-w-0 px-2 py-2 whitespace-normal"
                    aria-pressed={side === index}
                    variant={side === index ? "default" : "secondary"}
                    disabled={busy || !preview.sideAvailability[index]}
                    onClick={() => setSide(index === 0 ? 0 : 1)}
                  >
                    Choose this position
                  </Button>
                </div>
              ))}
            </div>
            {side !== undefined && (
              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void join(false);
                }}
              >
                <label htmlFor="invite-1">
                  Display name
                  <Input
                    id="invite-1"
                    value={name}
                    required
                    maxLength={40}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  Join as debater
                </Button>
              </form>
            )}
            <Button disabled={busy} onClick={() => void join(true)}>
              Spectate
            </Button>
          </>
        ) : (
          !error && <p>Loading invitation…</p>
        )}
        <Link to="/">Return home</Link>
      </main>
    </>
  );
}
