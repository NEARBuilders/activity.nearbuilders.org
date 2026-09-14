import { z } from "every-plugin/zod";
import type { AuthContext } from "./auth";

export const ContextSchema = z.custom<AuthContext>();
