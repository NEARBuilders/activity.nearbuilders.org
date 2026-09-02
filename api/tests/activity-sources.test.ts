import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getActivitySourcesService } from "./setup";

describe("Activity Source registry", () => {
  it("returns only approved sources for ingestion", async () => {
    const registry = await getActivitySourcesService();
    const sourceId = `ingestion-${randomUUID()}`;
    await registry.createSource({
      sourceId,
      displayName: "Ingestion Source",
      nearAccountId: `${randomUUID()}.near`,
      organizationId: `org-${randomUUID()}`,
      eventTypes: [
        {
          name: "ingestion.action",
          description: "An approved action",
          enabled: true,
          pointValue: 5,
        },
      ],
    });

    await expect(registry.getApprovedSourceForIngestion(sourceId)).rejects.toThrow(
      "Activity Source is not approved for ingestion",
    );

    await registry.reviewSource({
      sourceId,
      decision: "approved",
      reason: "Source ownership verified",
      administratorId: "platform-admin",
    });

    await expect(registry.getApprovedSourceForIngestion(sourceId)).resolves.toMatchObject({
      sourceId,
      approvalStatus: "approved",
      canIngest: true,
    });
  });
});
