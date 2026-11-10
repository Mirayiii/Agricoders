export type AdminRequestState = {
  state: "new" | "pending" | "done";
  target_user_id: string | null;
  details: Record<string, unknown>;
  result: Record<string, unknown> | null;
};

/** What every admin function needs to know who is calling and to make retries safe. */
export type AdminDeps = {
  /** The caller's user id if the token is valid and belongs to an active administrator. */
  callerAdmin(token: string): Promise<{ userId: string } | "unauthorized" | "forbidden">;
  beginRequest(actor: string, requestId: string, rpc: string, argsHash: string, target: string | null, details: Record<string, unknown>): Promise<AdminRequestState | "request_id_reused">;
  finishRequest(actor: string, requestId: string, result: Record<string, unknown>): Promise<void>;
  temporaryPassword(requestId: string): Promise<string>;
  hash(value: string): Promise<string>;
};
