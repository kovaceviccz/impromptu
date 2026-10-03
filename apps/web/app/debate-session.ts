import { apiContract, type JoinResult } from "@impromptu/api/contracts";

/**
 * Persists the active debate session in sessionStorage so a page refresh can
 * reconnect to the same LiveKit room with the same identity, role, display
 * name and (for spectators) vote.
 *
 * sessionStorage is per-tab, so two tabs can still be two different people.
 */
export type DebateSession = {
  join: JoinResult;
  displayName?: string;
  vote?: "0" | "1";
};

const KEY_PREFIX = "impromptu.debate.";

function key(topicId: string) {
  return KEY_PREFIX + topicId;
}

function store(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isTokenExpired(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: number };
    // Treat tokens expiring within 30s as expired.
    return typeof exp === "number" && exp * 1000 <= Date.now() + 30_000;
  } catch {
    return false;
  }
}

export function saveDebateSession(session: DebateSession) {
  try {
    store()?.setItem(key(session.join.topicId), JSON.stringify(session));
  } catch {
    // Storage full or unavailable: refresh persistence is best-effort.
  }
}

export function clearDebateSession(topicId: string) {
  try {
    store()?.removeItem(key(topicId));
  } catch {
    // ignore
  }
}

export function loadDebateSession(topicId: string): DebateSession | null {
  const raw = store()?.getItem(key(topicId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<DebateSession>;
    const join: JoinResult = apiContract.join.response.parse(parsed.join);
    if (join.topicId !== topicId || isTokenExpired(join.token)) {
      clearDebateSession(topicId);
      return null;
    }
    return {
      join,
      displayName:
        typeof parsed.displayName === "string" ? parsed.displayName : undefined,
      vote: parsed.vote === "0" || parsed.vote === "1" ? parsed.vote : undefined,
    };
  } catch {
    clearDebateSession(topicId);
    return null;
  }
}

export function updateDebateSession(
  topicId: string,
  patch: Partial<Omit<DebateSession, "join">>,
) {
  const current = loadDebateSession(topicId);
  if (!current) return;
  saveDebateSession({ ...current, ...patch });
}
