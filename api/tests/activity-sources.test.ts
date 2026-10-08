import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getActivitySourcesService } from "./setup";

describe("Activity Source registry", () => {
  it("returns pending and approved sources for ingestion but not rejected ones", async () => {
    const registry = await getActivitySourcesService();
    const createSource = async (sourceId: string) =>
      registry.createSource({
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
    const sourceId = `ingestion-${randomUUID()}`;
    await createSource(sourceId);

    await expect(registry.getSourceForIngestion(sourceId)).resolves.toMatchObject({
      sourceId,
      approvalStatus: "pending",
      canIngest: true,
    });

    await registry.reviewSource({
      sourceId,
      decision: "approved",
      reason: "Source ownership verified",
      administratorId: "platform-admin",
    });

    await expect(registry.getSourceForIngestion(sourceId)).resolves.toMatchObject({
      sourceId,
      approvalStatus: "approved",
      canIngest: true,
    });

    const rejectedSourceId = `ingestion-${randomUUID()}`;
    await createSource(rejectedSourceId);
    await registry.reviewSource({
      sourceId: rejectedSourceId,
      decision: "rejected",
      reason: "Source ownership could not be verified",
      administratorId: "platform-admin",
    });

    await expect(registry.getSourceForIngestion(rejectedSourceId)).rejects.toThrow(
      "Activity Source was rejected",
    );
  });
});
