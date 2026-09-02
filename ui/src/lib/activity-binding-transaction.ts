import type { Near } from "near-kit";

export interface ActivityBindingWrite {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  attachedDeposit: string;
}

interface ContractCall {
  signerId: string;
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  attachedDeposit: string;
}

export interface ActivityBindingWallet {
  switchToMainnet: () => void;
  connect: () => Promise<boolean>;
  getActiveAccount: () => { accountId: string | null; network: string } | null;
  callContract: (call: ContractCall) => Promise<{ txHash: string | null }>;
}

interface BetterNearWalletClient {
  setNetwork: (network: "mainnet" | "testnet") => void;
  ensureConnected: () => Promise<boolean>;
  getState: () => { accountId: string | null; networkId: string } | null;
  getNearClient: () => Pick<Near, "transaction">;
}

export function createActivityBindingWallet(near: BetterNearWalletClient): ActivityBindingWallet {
  return {
    switchToMainnet: () => near.setNetwork("mainnet"),
    connect: () => near.ensureConnected(),
    getActiveAccount: () => {
      const state = near.getState();
      if (!state) return null;
      return { accountId: state.accountId, network: state.networkId };
    },
    callContract: async (call) => {
      const result = await near
        .getNearClient()
        .transaction(call.signerId)
        .functionCall(call.contractId, call.methodName, call.args, {
          gas: call.gas as `${number}`,
          attachedDeposit: BigInt(call.attachedDeposit),
        })
        .send({ waitUntil: "FINAL" });

      return { txHash: result.transaction.hash ?? null };
    },
  };
}

export async function submitActivityBindingTransaction({
  wallet,
  nearAccountId,
  binding,
}: {
  wallet: ActivityBindingWallet;
  nearAccountId: string;
  binding: ActivityBindingWrite;
}): Promise<{ txHash: string | null }> {
  wallet.switchToMainnet();
  const connected = await wallet.connect();
  if (!connected) {
    throw new Error(`Connect ${nearAccountId} on NEAR mainnet to continue.`);
  }

  const activeAccount = wallet.getActiveAccount();
  if (activeAccount?.network !== "mainnet") {
    throw new Error("Switch your wallet to NEAR mainnet to authorize this source.");
  }
  if (activeAccount.accountId !== nearAccountId) {
    throw new Error(`Connect ${nearAccountId} to authorize this Activity Source.`);
  }

  return wallet.callContract({
    signerId: nearAccountId,
    contractId: binding.contractId,
    methodName: binding.methodName,
    args: binding.args,
    gas: binding.gas,
    attachedDeposit: binding.attachedDeposit,
  });
}
