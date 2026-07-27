// Minimal JSON-RPC client shared by fork-snapshot.ts (evm_snapshot/evm_revert)
// and chain.ts (viem transport target). Kept dependency-free (Node's built-in
// fetch) since it's only ever a handful of Anvil-specific calls.
export const RPC_URL = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8545";

let nextId = 1;

export async function rpcCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!res.ok) {
    throw new Error(`${method} against ${RPC_URL} failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message: string; code: number } };
  if (json.error) {
    throw new Error(`${method} against ${RPC_URL} failed: ${json.error.message} (code ${json.error.code})`);
  }
  return json.result as T;
}
