// GENERATED FILE — do not edit. Regenerated from the installed framework version
// by `bos dev` / `bos build` / `bos typecheck` (gitignored).
import "./styles.css";
import { hydrate as coreHydrate } from "everything-dev/ui/hydrate";
import { apiConnectionError } from "./app";
import { createQueryClient, createRouter } from "./router";

export function hydrate() {
  return coreHydrate({
    routeConfig: () => import("./routeConfig.gen"),
    manifest: () => import("./manifest.gen.json"),
    createRouter,
    createQueryClient,
    apiConnectionError,
  });
}

export default hydrate;
