export const topicPresets = [
  {
    id: "dream-cheating",
    category: "Philosophy",
    title: "Can you cheat in a dream?",
    sides: [
      "Yes: intention still matters",
      "No: dreams are involuntary",
    ] as const,
  },
  {
    id: "moral-lying",
    category: "Philosophy",
    title: "Is lying ever moral?",
    sides: ["Yes: context matters", "No: lying is always wrong"] as const,
  },
  {
    id: "privacy-right",
    category: "Society",
    title: "Is privacy a human right?",
    sides: [
      "Yes: privacy is fundamental",
      "No: privacy is conditional",
    ] as const,
  },
  {
    id: "anime-manga",
    category: "Entertainment",
    title: "What is better, anime or manga?",
    sides: [
      "Anime: visual and audio experience",
      "Manga: the author's original intent",
    ] as const,
  },
  {
    id: "free-will",
    category: "Philosophy",
    title: "Do people have free will?",
    sides: ["Yes: choices are genuinely ours", "No: choices are determined"],
  },
  {
    id: "artificial-intelligence-consciousness",
    category: "Philosophy",
    title: "Could AI become conscious?",
    sides: [
      "Yes: consciousness is a system property",
      "No: consciousness requires biology",
    ],
  },
  {
    id: "universal-basic-income",
    category: "Society",
    title: "Should every adult receive universal basic income?",
    sides: ["Yes: guarantees basic dignity", "No: rewards should require work"],
  },
  {
    id: "voting-age",
    category: "Society",
    title: "Should the voting age be lowered to 16?",
    sides: [
      "Yes: young people deserve representation",
      "No: maturity matters more",
    ],
  },
  {
    id: "books-tv",
    category: "Entertainment",
    title: "Are books better than television?",
    sides: ["Books: deeper imagination", "TV: richer shared experience"],
  },
  {
    id: "streaming-theater",
    category: "Entertainment",
    title: "Is streaming better than going to the theater?",
    sides: [
      "Streaming: convenient and flexible",
      "Theater: communal and immersive",
    ],
  },
  {
    id: "hardest-sport",
    category: "Sports",
    title: "Which sport is the hardest to master?",
    sides: [
      "Boxing: extreme physical demands",
      "Golf: precision under pressure",
    ],
  },
  {
    id: "football-soccer",
    category: "Sports",
    title: "Which is better, football or soccer?",
    sides: ["Football: explosive strategy", "Soccer: fluid global play"],
  },
  {
    id: "greatest-athlete",
    category: "Sports",
    title: "Who is the greater athlete, Michael Jordan or Tiger Woods?",
    sides: [
      "Michael Jordan: six-time champion",
      "Tiger Woods: golfing record-breaker",
    ],
  },
  {
    id: "live-studio",
    category: "Music",
    title: "Are live performances better than studio albums?",
    sides: ["Live: spontaneous and shared", "Studio: polished and precise"],
  },
  {
    id: "vinyl-streaming",
    category: "Music",
    title: "Is vinyl better than music streaming?",
    sides: [
      "Vinyl: tactile and immersive",
      "Streaming: accessible and expansive",
    ],
  },
  {
    id: "greatest-artist",
    category: "Music",
    title: "Who is the better artist, Beyoncé or Taylor Swift?",
    sides: [
      "Beyoncé: unmatched performance craft",
      "Taylor Swift: unmatched songwriting craft",
    ],
  },
  {
    id: "movie-franchise-impact",
    category: "Entertainment",
    title: "Which movie franchise has had more impact, Star Wars or Marvel?",
    sides: [
      "Star Wars: changed cinematic spectacle",
      "Marvel: built a shared universe",
    ],
  },
  {
    id: "director-artistry",
    category: "Entertainment",
    title:
      "Which director is more artistic, Christopher Nolan or Quentin Tarantino?",
    sides: [
      "Christopher Nolan: grand ideas and scale",
      "Quentin Tarantino: bold style and dialogue",
    ],
  },
  {
    id: "movie-remakes",
    category: "Entertainment",
    title: "Are movie remakes usually worthwhile?",
    sides: [
      "Yes: familiar stories gain fresh value",
      "No: remakes lack originality",
    ],
  },
  {
    id: "game-movie-adaptations",
    category: "Entertainment",
    title: "Do video game adaptations make better movies or shows?",
    sides: ["Movies: cinematic and focused", "Shows: expansive and episodic"],
  },
] as const;

export type TopicPreset = (typeof topicPresets)[number];

export { topicPresets as topics };

export function findTopic(topicId: string) {
  return topicPresets.find((topic) => topic.id === topicId);
}
