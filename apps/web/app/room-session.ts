import { joinResultSchema, type JoinResult } from "@impromptu/api/contracts";

const keyFor = (topicId: string) => `impromptu.room.${topicId}`;
const preferencesKeyFor = (topicId: string) =>
  `impromptu.room-prefs.${topicId}`;

type RoomPreferences = { displayName?: string; vote?: "0" | "1" };

export function roomPreferences(topicId: string): RoomPreferences {
  try {
    const raw = sessionStorage.getItem(preferencesKeyFor(topicId));
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return {};
    const displayName = "displayName" in value ? value.displayName : undefined;
    const vote = "vote" in value ? value.vote : undefined;
    return {
      displayName: typeof displayName === "string" ? displayName : undefined,
      vote: vote === "0" || vote === "1" ? vote : undefined,
    };
  } catch {
    return {};
  }
}

export function updateRoomPreferences(topicId: string, patch: RoomPreferences) {
  try {
    sessionStorage.setItem(
      preferencesKeyFor(topicId),
      JSON.stringify({ ...roomPreferences(topicId), ...patch }),
    );
  } catch {
    // Storage can be disabled; the current room remains usable.
  }
}

/** Room credentials and the creator's code stay in this browser tab. */
export function rememberRoom(join: JoinResult) {
  try {
    sessionStorage.setItem(keyFor(join.topicId), JSON.stringify(join));
    if (join.role === "spectator" && join.displayName !== "Spectator") {
      updateRoomPreferences(join.topicId, { displayName: join.displayName });
    }
  } catch {
    // Storage can be disabled; the current room remains usable.
  }
}

export function recalledRoom(topicId: string): JoinResult | undefined {
  try {
    const value = sessionStorage.getItem(keyFor(topicId));
    if (!value) return undefined;
    const result = joinResultSchema.safeParse(JSON.parse(value));
    if (
      result.success &&
      result.data.topicId === topicId &&
      !tokenIsExpiring(result.data.token)
    )
      return result.data;
    forgetRoom(topicId);
  } catch {
    forgetRoom(topicId);
  }
  return undefined;
}

function tokenIsExpiring(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const parsed: unknown = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (!parsed || typeof parsed !== "object") return false;
    const exp = (parsed as { exp?: unknown }).exp;
    return typeof exp === "number" && exp * 1000 <= Date.now() + 30_000;
  } catch {
    return false;
  }
}

export function forgetRoom(topicId: string) {
  try {
    sessionStorage.removeItem(keyFor(topicId));
    sessionStorage.removeItem(preferencesKeyFor(topicId));
  } catch {
    // Storage can be disabled.
  }
}
