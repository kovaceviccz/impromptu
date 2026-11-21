import { describe, expect, it } from "vitest";

import { lobbyTags, topicCategories } from "./contract.js";
import { findTopic, topics, topicPresets } from "./data.js";
import { demoTopicDefinitions } from "./seed-demo.js";

describe("demo topic coverage", () => {
  it("keeps one or two examples of every category and tag across public and private demos", () => {
    const seeded = [...topics, ...demoTopicDefinitions];
    for (const category of topicCategories) {
      const count = seeded.filter(
        (topic) => topic.category === category,
      ).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    }
    for (const tag of lobbyTags) {
      const count = seeded.filter((topic) =>
        topic.tags.some((value) => value === tag),
      ).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
      expect(
        topics.some((topic) => topic.tags.some((value) => value === tag)) ||
          demoTopicDefinitions.some(
            (topic) =>
              topic.visibility === "public" &&
              topic.tags.some((value) => value === tag),
          ),
      ).toBe(true);
    }
  });

  it("preserves the three starter rooms and the full prewritten library", () => {
    expect(topics.slice(0, 3).map((topic) => topic.id)).toEqual([
      "dream-cheating",
      "moral-lying",
      "privacy-right",
    ]);
    expect(topicPresets).toHaveLength(20);
    expect(topics.some((topic) => topic.id === "free-will")).toBe(false);
    expect(findTopic("free-will")?.title).toBe("Do people have free will?");
  });
});
