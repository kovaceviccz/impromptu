export const CHAT_RATE_LIMIT = {
  cooldownMs: 10_000,
  maxMessages: 5,
  windowMs: 10_000,
} as const;

type ChatRejection = {
  allowed: false;
  code: "DUPLICATE_MESSAGE" | "INAPPROPRIATE_LANGUAGE" | "RATE_LIMITED";
  message: string;
  retryAfterSeconds?: number;
};

export type ChatPolicyResult = { allowed: true } | ChatRejection;

type ParticipantState = {
  acceptedAt: number[];
  blockedUntil: number;
  lastMessage?: string;
};

const blockedTerms = [
  "ass",
  "asses",
  "asshat",
  "asshats",
  "asshole",
  "assholes",
  "bastard",
  "bastards",
  "bitch",
  "bitches",
  "bitching",
  "bollock",
  "bollocks",
  "bullshit",
  "bullshitting",
  "cock",
  "cocks",
  "cocksucker",
  "cocksuckers",
  "crap",
  "crappy",
  "cunt",
  "cunts",
  "damn",
  "damned",
  "dick",
  "dickhead",
  "dickheads",
  "dicks",
  "douche",
  "douchebag",
  "douchebags",
  "douches",
  "fag",
  "fags",
  "faggot",
  "faggots",
  "fuck",
  "fucked",
  "fucker",
  "fuckers",
  "fucking",
  "fucks",
  "goddamn",
  "goddamned",
  "motherfucker",
  "motherfuckers",
  "motherfucking",
  "nigga",
  "niggas",
  "nigger",
  "niggers",
  "piss",
  "pissed",
  "pisses",
  "pissing",
  "prick",
  "pricks",
  "pussies",
  "pussy",
  "shit",
  "shithead",
  "shitheads",
  "shits",
  "shitted",
  "shitting",
  "shitty",
  "slut",
  "sluts",
  "slutty",
  "twat",
  "twats",
  "wank",
  "wanked",
  "wanker",
  "wankers",
  "wanking",
  "wanks",
  "whore",
  "whores",
] as const;

const blockedPatterns = blockedTerms.map((term) => {
  const letters = term.split("");
  const separatedLetters = letters
    .map((letter, index) =>
      index === letters.length - 1 ? `${letter}{1}` : `${letter}+`,
    )
    .join("[^a-z]*");
  return new RegExp(`(?:^|[^a-z])${separatedLetters}(?:$|[^a-z])`, "u");
});

function normalizedCharacters(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("@", "a")
    .replaceAll("$", "s")
    .replace(/(?<=[a-z])[!|](?=[a-z])/g, "i")
    .replace(
      /[0-9]/g,
      (character) =>
        ({
          "0": "o",
          "1": "i",
          "2": "z",
          "3": "e",
          "4": "a",
          "5": "s",
          "6": "g",
          "7": "t",
          "8": "b",
          "9": "g",
        })[character] ?? character,
    )
    .replace(
      /[аеіοсхук]/gu,
      (character) =>
        ({
          а: "a",
          е: "e",
          і: "i",
          ο: "o",
          с: "c",
          х: "x",
          у: "y",
          к: "k",
        })[character] ?? character,
    );
}

function duplicateKey(value: string) {
  return normalizedCharacters(value)
    .replace(/\p{P}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsBlockedLanguage(value: string) {
  const normalized = normalizedCharacters(value);
  return blockedPatterns.some((pattern) => pattern.test(normalized));
}

export class ChatPolicy {
  readonly #now: () => number;
  readonly #participants = new Map<string, ParticipantState>();

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  check(
    roomName: string,
    participantIdentity: string,
    message: string,
  ): ChatPolicyResult {
    const now = this.#now();
    const key = `${roomName}\u0000${participantIdentity}`;
    const state = this.#participants.get(key) ?? {
      acceptedAt: [],
      blockedUntil: 0,
    };

    if (state.blockedUntil > now) {
      return {
        allowed: false,
        code: "RATE_LIMITED",
        message:
          "You are sending messages too quickly. Please wait a moment and try again.",
        retryAfterSeconds: Math.ceil((state.blockedUntil - now) / 1000),
      };
    }

    state.acceptedAt = state.acceptedAt.filter(
      (sentAt) => now - sentAt < CHAT_RATE_LIMIT.windowMs,
    );
    if (state.acceptedAt.length >= CHAT_RATE_LIMIT.maxMessages) {
      state.blockedUntil = now + CHAT_RATE_LIMIT.cooldownMs;
      this.#participants.set(key, state);
      return {
        allowed: false,
        code: "RATE_LIMITED",
        message:
          "You are sending messages too quickly. Please wait 10 seconds and try again.",
        retryAfterSeconds: CHAT_RATE_LIMIT.cooldownMs / 1000,
      };
    }
    const normalized = duplicateKey(message);
    if (state.lastMessage === normalized) {
      return {
        allowed: false,
        code: "DUPLICATE_MESSAGE",
        message: "Please do not send the same message twice in a row.",
      };
    }

    if (containsBlockedLanguage(message)) {
      return {
        allowed: false,
        code: "INAPPROPRIATE_LANGUAGE",
        message:
          "That message contains language that is not allowed. Please revise it.",
      };
    }

    state.acceptedAt.push(now);
    state.lastMessage = normalized;
    state.blockedUntil = 0;
    this.#participants.set(key, state);
    return { allowed: true };
  }
}
