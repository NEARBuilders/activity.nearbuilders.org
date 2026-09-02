import { describe, expect, it, vi } from "vitest";
import {
  type ActivityBindingWallet,
  submitActivityBindingTransaction,
} from "@/lib/activity-binding-transaction";

describe("submitActivityBindingTransaction", () => {
  it("switches to mainnet and sends the binding from its exact NEAR account", async () => {
    const switchToMainnet = vi.fn();
    const connect = vi.fn().mockResolvedValue(true);
    const callContract = vi.fn().mockResolvedValue({ txHash: "mainnet-transaction" });
    const wallet: ActivityBindingWallet = {
      switchToMainnet,
      connect,
      getActiveAccount: () => ({ accountId: "feedback.near", network: "mainnet" }),
      callContract,
    };

    await expect(
      submitActivityBindingTransaction({
        wallet,
        nearAccountId: "feedback.near",
        binding: {
          contractId: "contextual.near",
          methodName: "set",
          args: { key: "nostr:feedback.near", value: "pubkey" },
          gas: "30000000000000",
          attachedDeposit: "0",
        },
      }),
    ).resolves.toEqual({ txHash: "mainnet-transaction" });

    expect(switchToMainnet).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
    expect(callContract).toHaveBeenCalledWith({
      signerId: "feedback.near",
      contractId: "contextual.near",
      methodName: "set",
      args: { key: "nostr:feedback.near", value: "pubkey" },
      gas: "30000000000000",
      attachedDeposit: "0",
    });
  });

  it("refuses to bind when the connected wallet is on a different network", async () => {
    const callContract = vi.fn();
    const wallet: ActivityBindingWallet = {
      switchToMainnet: vi.fn(),
      connect: vi.fn().mockResolvedValue(true),
      getActiveAccount: () => ({ accountId: "feedback.near", network: "testnet" }),
      callContract,
    };

    await expect(
      submitActivityBindingTransaction({
        wallet,
        nearAccountId: "feedback.near",
        binding: {
          contractId: "contextual.near",
          methodName: "set",
          args: {},
          gas: "30000000000000",
          attachedDeposit: "0",
        },
      }),
    ).rejects.toThrow("Switch your wallet to NEAR mainnet");
    expect(callContract).not.toHaveBeenCalled();
  });

  it("refuses to bind when a different account is connected", async () => {
    const callContract = vi.fn();
    const wallet: ActivityBindingWallet = {
      switchToMainnet: vi.fn(),
      connect: vi.fn().mockResolvedValue(true),
      getActiveAccount: () => ({ accountId: "alice.near", network: "mainnet" }),
      callContract,
    };

    await expect(
      submitActivityBindingTransaction({
        wallet,
        nearAccountId: "feedback.near",
        binding: {
          contractId: "contextual.near",
          methodName: "set",
          args: {},
          gas: "30000000000000",
          attachedDeposit: "0",
        },
      }),
    ).rejects.toThrow("Connect feedback.near");
    expect(callContract).not.toHaveBeenCalled();
  });
});
