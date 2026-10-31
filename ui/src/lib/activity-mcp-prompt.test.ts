import { describe, expect, it } from "vitest";
import { buildActivityMcpPrompt } from "@/lib/activity-mcp-prompt";

describe("Activity MCP prompt", () => {
  it("points the agent at this site's MCP endpoint and tools", () => {
    const prompt = buildActivityMcpPrompt("https://activity.example/");

    expect(prompt).toContain(
      "claude mcp add --transport http activity https://activity.example/api/v1/mcp",
    );
    for (const tool of [
      "start_activity_registration",
      "check_activity_registration",
      "submit_activity_event",
    ]) {
      expect(prompt).toContain(tool);
    }
    expect(prompt).toContain("ACTIVITY_API_KEY=<your Source API Key>");
    expect(prompt).toContain("https://activity.example/skill.md");
  });
});
