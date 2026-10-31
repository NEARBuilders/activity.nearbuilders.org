import { z } from "zod";
import type { AuthContext } from "./auth";

export type ActivityRequestContext = Omit<AuthContext, "session">;

export const ActivityContextSchema = z.custom<ActivityRequestContext>();
