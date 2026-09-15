import { healthContract } from "./health/contract.js";
import { topicContracts } from "./topics/contract.js";

export {
  errorSchema,
  joinBodySchema,
  type JoinInput,
  type JoinResult,
  type SideUnavailableError,
  type TopicStatus,
} from "./topics/contract.js";

export const PRODUCT = {
  name: "impromptu",
  domain: "impromptu.social",
} as const;

export const apiContract = {
  health: healthContract,
  ...topicContracts,
} as const;
