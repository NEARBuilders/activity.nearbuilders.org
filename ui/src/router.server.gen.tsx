// GENERATED FILE — do not edit. Regenerated from the installed framework version
// by `bos dev` / `bos build` / `bos typecheck` (gitignored).
import { createServerRouterModule } from "everything-dev/ui/router-server";
import { appLocale } from "./app";
import { createQueryClient, createRouter } from "./router";
import { routeTree } from "./routeTree.gen";

const routerModule = createServerRouterModule({
  defaultRouteTree: routeTree,
  createRouter,
  createQueryClient,
  locale: appLocale,
});

export default routerModule;
