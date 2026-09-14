import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getAppName, sessionQueryOptions, useAuthClient } from "@/app";
import { BrandElement } from "@/components/brand-element";
import { Button } from "@/components/ui/button";

type SearchParams = {
  redirect?: string;
};

export const Route = createFileRoute("/_layout/login")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    const { queryClient, authClient } = context;
    const initialSession = context.session;
    const session =
      initialSession ??
      queryClient.getQueryData(sessionQueryOptions(authClient, initialSession).queryKey);

    if (session?.user) {
      const redirectTo = search.redirect?.startsWith("/") ? search.redirect : "/home";
      throw redirect({ to: redirectTo, search: {} });
    }
  },
  loader: ({ context }) => {
    const initialSession = context.session;
    void context.queryClient.prefetchQuery(sessionQueryOptions(context.authClient, initialSession));
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));
  const { redirect } = Route.useSearch();
  const { runtimeConfig } = Route.useRouteContext();
  const appName = getAppName(runtimeConfig);

  const [nearPending, setNearPending] = useState(false);
  const [detectedAccount, setDetectedAccount] = useState<string | null>(null);

  useEffect(() => {
    auth.near.detectNearAccount().then((result) => {
      if (result?.accountId) {
        setDetectedAccount(result.accountId);
      }
    });
  }, [auth.near]);

  const handleSuccess = async (message: string) => {
    const redirectTo = redirect?.startsWith("/") ? redirect : "/home";
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: ["session"] });
    navigate({ to: redirectTo, replace: true, search: {} });
  };

  const handleError = (error: { code?: string; message?: string } | Error) => {
    const code = "code" in error ? error.code : undefined;
    const message = "message" in error ? error.message : "Failed to sign in";
    if (code === "UNAUTHORIZED_NONCE_REPLAY") toast.error("Sign-in already used");
    else if (code === "UNAUTHORIZED_INVALID_SIGNATURE") toast.error("Invalid signature");
    else if (code === "SIGNER_NOT_AVAILABLE") toast.error("NEAR wallet not available");
    else if (code === "RECIPIENT_MISMATCH") toast.error("Sign-in configuration error");
    else if (code === "UNAUTHORIZED_INVALID_NONCE")
      toast.error("Session expired, please try again");
    else toast.error(message || "Failed to sign in");
  };

  const handleNear = async () => {
    setNearPending(true);
    await auth.signIn.near({
      onSuccess: async () => {
        setNearPending(false);
        await handleSuccess("Signed in with NEAR");
      },
      onError: (error: { code?: string; message?: string }) => {
        setNearPending(false);
        handleError(error);
      },
    });
  };

  if (session?.user) {
    const redirectTo = redirect?.startsWith("/") ? redirect : "/home";
    return <Navigate to={redirectTo} replace search={{}} />;
  }

  const isPending = nearPending;

  return (
    <div className="min-h-[calc(100dvh-7rem)] lg:min-h-[calc(100dvh-4rem)] w-full flex flex-col animate-fade-in">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm flex flex-col items-center gap-5">
          <BrandElement appName={appName} size="lg" />
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Welcome to Activity
            </h1>
          </div>

          <div className="w-full border-b border-border pb-6 sm:p-8 space-y-5">
            <div className="space-y-3">
              {detectedAccount ? (
                <>
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleNear}
                    disabled={isPending}
                    className="w-full"
                  >
                    {nearPending ? "connecting..." : `Continue as ${detectedAccount}`}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleNear}
                    disabled={isPending}
                    className="w-full"
                  >
                    Use another wallet
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleNear}
                  disabled={isPending}
                  className="w-full"
                >
                  {nearPending ? "connecting..." : "Connect your wallet"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
