export const topics = [
  {
    id: "dream-cheating",
    title: "Can you cheat in a dream?",
    sides: ["Yes: intention still matters", "No: dreams are involuntary"],
  },
  {
    id: "moral-lying",
    title: "Is lying ever moral?",
    sides: ["Yes: context matters", "No: lying is always wrong"],
  },
  {
    id: "privacy-right",
    title: "Is privacy a human right?",
    sides: ["Yes: privacy is fundamental", "No: privacy is conditional"],
  },
] as const;

export type PrivateLobby = {
  lobbyId: string;
  topicId: string;
  code: string;
  creatorIdentity: string;
};

const privateLobbiesByCode = new Map<string, PrivateLobby>();

function generateJoinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

export function generateUniqueJoinCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = generateJoinCode();
    if (!privateLobbiesByCode.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique private topic code");
}

export function createPrivateLobby(
  topicId: string,
  lobbyId: string,
  creatorIdentity: string,
) {
  const code = generateUniqueJoinCode();

  privateLobbiesByCode.set(code, {
    lobbyId,
    topicId,
    code,
    creatorIdentity,
  });

  return code;
}

export function findPrivateLobbyByCode(code: string) {
  return privateLobbiesByCode.get(code);
}

export function findPrivateLobbyById(lobbyId: string) {
  return [...privateLobbiesByCode.values()].find(
    (lobby) => lobby.lobbyId === lobbyId,
  );
}

export function deletePrivateLobby(code: string) {
  privateLobbiesByCode.delete(code);
}

export function findTopic(topicId: string) {
  return topics.find((topic) => topic.id === topicId);
}
