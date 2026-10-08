import { accountContracts } from "./accounts/contract.js";
import { healthContract } from "./health/contract.js";
import { topicContracts } from "./topics/contract.js";

export {
  firstFieldErrors,
  formErrorSchema,
  loginBodySchema,
  registerBodySchema,
  updateAccountBodySchema,
  type Account,
  type FormError,
  type LoginInput,
  type RegisterInput,
  type UpdateAccountInput,
} from "./accounts/contract.js";
export { type LobbyState } from "./lobbies/contract.js";
export {
  errorSchema,
  joinBodySchema,
  joinResultSchema,
  lobbyCreateBodySchema,
  startDebateBodySchema,
  startDebateResultSchema,
  sideUnavailableErrorSchema,
  type JoinInput,
  type JoinByCodeInput,
  type JoinResult,
  type LobbyCreateInput,
  type LobbyParticipant,
  type PublicLobby,
  type PrivateLobbyPreview,
  type SideUnavailableError,
  type StartDebateInput,
  type StartDebateResult,
  type TopicStatus,
} from "./topics/contract.js";

export const PRODUCT = {
  name: "impromptu",
  domain: "impromptu.social",
} as const;

export const apiContract = {
  health: healthContract,
  ...accountContracts,
  ...topicContracts,
} as const;
