import { accountContracts } from "./accounts/contract.js";
import { healthContract } from "./health/contract.js";
import { topicContracts } from "./topics/contract.js";

export {
  firstFieldErrors,
  formErrorSchema,
  loginBodySchema,
  registerBodySchema,
  type Account,
  type FormError,
  type LoginInput,
  type RegisterInput,
} from "./accounts/contract.js";
export {
  errorSchema,
  joinBodySchema,
  type JoinInput,
  type JoinResult,
  type LobbyParticipant,
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
  ...topicContracts,
} as const;
