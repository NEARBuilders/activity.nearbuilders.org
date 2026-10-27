import { ORPCError } from "@orpc/server";

export const RelayErrors = {
  RELAY_UNAVAILABLE: { status: 503, message: "Relay unavailable" },
  RELAY_TIMEOUT: { status: 504, message: "Relay response timed out" },
  RELAY_LIMIT: { status: 503, message: "Relay replay or consumer buffer limit reached" },
} as const;

export function relayError(error: unknown): ORPCError<string, unknown> {
  return error instanceof ORPCError
    ? error
    : new ORPCError("RELAY_UNAVAILABLE", { message: "Relay unavailable" });
}
