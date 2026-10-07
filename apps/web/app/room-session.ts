import { joinResultSchema, type JoinResult } from "@impromptu/api/contracts";

const keyFor = (topicId: string) => `impromptu.room.${topicId}`;

/** Room credentials and the creator's code stay in this browser tab. */
export function rememberRoom(join: JoinResult) {
  try {
    sessionStorage.setItem(keyFor(join.topicId), JSON.stringify(join));
  } catch {
    // Storage can be disabled; the current room remains usable.
  }
}

export function recalledRoom(topicId: string): JoinResult | undefined {
  try {
    const value = sessionStorage.getItem(keyFor(topicId));
    if (!value) return undefined;
    const result = joinResultSchema.safeParse(JSON.parse(value));
    if (result.success && result.data.topicId === topicId) return result.data;
    forgetRoom(topicId);
  } catch {
    forgetRoom(topicId);
  }
  return undefined;
}

export function forgetRoom(topicId: string) {
  try {
    sessionStorage.removeItem(keyFor(topicId));
  } catch {
    // Storage can be disabled.
  }
}
