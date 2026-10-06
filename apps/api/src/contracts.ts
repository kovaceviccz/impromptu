import { accountContracts } from "./accounts/contract.js";
import { healthContract } from "./health/contract.js";
import { lobbyContracts } from "./lobbies/contract.js";
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
export { type PublicLobbySummary } from "./lobbies/contract.js";
export {
  errorSchema,
  joinBodySchema,
  joinResultSchema,
  sideUnavailableErrorSchema,
  type JoinInput,
  type JoinByCodeInput,
  type JoinResult,
  type LobbyParticipant,
  type PrivateLobbyCreateInput,
  type PrivateLobbyPreview,
  type SideUnavailableError,
  type TopicStatus,
} from "./topics/contract.js";

export const PRODUCT = {
  name: "impromptu",
  domain: "impromptu.social",
} as const;

export const apiContract = {
  health: healthContract,
  ...accountContracts,
  ...lobbyContracts,
  ...topicContracts,
} as const;
