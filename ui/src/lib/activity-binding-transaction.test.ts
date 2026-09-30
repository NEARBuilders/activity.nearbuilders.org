import { describe, expect, it, vi } from "vitest";
import {
  type ActivityBindingWallet,
  submitActivityBindingTransaction,
} from "@/lib/activity-binding-transaction";

describe("submitActivityBindingTransaction", () => {
  it("reuses an already-known account instead of prompting a fresh wallet connect", async () => {
    const switchToMainnet = vi.fn();
    const connect = vi.fn().mockResolvedValue(true);
    const callContract = vi.fn().mockResolvedValue({ txHash: "mainnet-transaction" });
    const wallet: ActivityBindingWallet = {
      switchToMainnet,
      connect,
      disconnect: vi.fn().mockResolvedValue(undefined),
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
    expect(connect).not.toHaveBeenCalled();
    expect(callContract).toHaveBeenCalledWith({
      signerId: "feedback.near",
      contractId: "contextual.near",
      methodName: "set",
      args: { key: "nostr:feedback.near", value: "pubkey" },
      gas: "30000000000000",
      attachedDeposit: "0",
    });
  });

  it("connects only when no account is known yet", async () => {
    const connect = vi.fn().mockResolvedValue(true);
    const callContract = vi.fn().mockResolvedValue({ txHash: "tx" });
    let account: { accountId: string | null; network: string } | null = null;
    const wallet: ActivityBindingWallet = {
      switchToMainnet: vi.fn(),
      connect: async () => {
        account = { accountId: "feedback.near", network: "mainnet" };
        return connect();
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
      getActiveAccount: () => account,
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
    ).resolves.toEqual({ txHash: "tx" });

    expect(connect).toHaveBeenCalledOnce();
  });

  it("refuses to bind when the connected wallet is on a different network", async () => {
    const callContract = vi.fn();
    const wallet: ActivityBindingWallet = {
      switchToMainnet: vi.fn(),
      connect: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
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

  it("switches the wallet to the source account when another account is connected", async () => {
    let accountId = "alice.near";
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockImplementation(async () => {
      accountId = "feedback.near";
      return true;
    });
    const callContract = vi.fn().mockResolvedValue({ txHash: "switched" });
    const wallet: ActivityBindingWallet = {
      switchToMainnet: vi.fn(),
      connect,
      disconnect,
      getActiveAccount: () => ({ accountId, network: "mainnet" }),
      callContract,
    };

    await expect(
      submitActivityBindingTransaction({
        wallet,
        nearAccountId: "feedback.near",
        binding: {
          contractId: "contextual.near",
          methodName: "__fastdata_kv",
          args: {},
          gas: "20000000000000",
          attachedDeposit: "0",
        },
      }),
    ).resolves.toEqual({ txHash: "switched" });
    expect(disconnect).toHaveBeenCalledOnce();
    expect(callContract).toHaveBeenCalledOnce();
  });

  it("refuses to bind when the wallet still connects a different account", async () => {
    const callContract = vi.fn();
    const wallet: ActivityBindingWallet = {
      switchToMainnet: vi.fn(),
      connect: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
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

  it("reconnects and retries once when the remembered wallet session has gone stale", async () => {
    const connect = vi.fn().mockResolvedValue(true);
    const callContract = vi
      .fn()
      .mockRejectedValueOnce(new Error("No accounts found"))
      .mockResolvedValueOnce({ txHash: "retried" });
    const wallet: ActivityBindingWallet = {
      switchToMainnet: vi.fn(),
      connect,
      disconnect: vi.fn().mockResolvedValue(undefined),
      getActiveAccount: () => ({ accountId: "feedback.near", network: "mainnet" }),
      callContract,
    };

    await expect(
      submitActivityBindingTransaction({
        wallet,
        nearAccountId: "feedback.near",
        binding: {
          contractId: "contextual.near",
          methodName: "__fastdata_kv",
          args: {},
          gas: "20000000000000",
          attachedDeposit: "0",
        },
      }),
    ).resolves.toEqual({ txHash: "retried" });

    expect(connect).toHaveBeenCalledOnce();
    expect(callContract).toHaveBeenCalledTimes(2);
  });
});
