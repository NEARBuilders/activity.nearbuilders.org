import { runActivityExample } from "./activity-client";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const result = await runActivityExample({
  apiBaseUrl: process.env.ACTIVITY_API_BASE_URL?.trim() || "http://localhost:3000/api",
  apiKey: required("ACTIVITY_API_KEY"),
  source: required("ACTIVITY_SOURCE_ID"),
  eventType: required("ACTIVITY_EVENT_TYPE"),
  actor: required("ACTIVITY_ACTOR"),
  runId: required("ACTIVITY_EXAMPLE_RUN_ID"),
});

console.log(JSON.stringify(result, null, 2));
