export function activityMcpUrl(siteUrl: string) {
  return `${siteUrl.replace(/\/$/, "")}/api/v1/mcp`;
}

export function buildActivityMcpPrompt(siteUrl: string) {
  const site = siteUrl.replace(/\/$/, "");
  const mcpUrl = activityMcpUrl(site);
  return [
    `Integrate ${site} into this project so it reports what its users do, using the Activity MCP server.`,
    ``,
    `1. Connect the MCP server at ${mcpUrl} (Streamable HTTP, no credentials). In Claude Code: claude mcp add --transport http activity ${mcpUrl}`,
    `2. Find this project's nearbuilders.org page (https://nearbuilders.org/projects/<slug>) in the README, website, or package metadata. Ask me if you cannot find it.`,
    `3. Read the codebase and propose a few Event Types for meaningful user actions with a clear actor and moment, such as task.completed (lowercase, dot or dash separated, 0-100 points). The actor of every event is the user's NEAR account ID.`,
    `4. Call start_activity_registration with the project reference and the Event Types. Show me the url and the matchCode; I will sign in with my NEAR wallet, check the code, and approve one transaction.`,
    `5. Call check_activity_registration every 5 seconds until it is ready. Store the returned secret as ACTIVITY_API_KEY and the sourceId as ACTIVITY_SOURCE_ID in the gitignored .env, and never print the key.`,
    `   If this project already has an Activity Source, skip steps 4 and 5 and use ACTIVITY_API_KEY=<your Source API Key>.`,
    `6. Report each Event Type from server-side code with POST ${site}/api/v1/events and "Authorization: Bearer <ACTIVITY_API_KEY>", with a stable idempotencyKey per event, as described in ${site}/skill.md.`,
    `7. Call submit_activity_event with eventType activity.test and a real NEAR account as actor, then tell me the sourceId, the test eventId, and where in the code each Event Type is reported.`,
  ].join("\n");
}
