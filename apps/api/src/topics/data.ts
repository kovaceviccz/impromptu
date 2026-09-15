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

export function findTopic(topicId: string) {
  return topics.find((topic) => topic.id === topicId);
}
