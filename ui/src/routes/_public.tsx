import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ensureShellData } from "@/lib/app-shell";

export const Route = createFileRoute("/_public")({
  beforeLoad: async ({ context }) => {
    await ensureShellData(context);
  },
  component: PublicLayout,
});

function PublicLayout() {
  return <Outlet />;
}
