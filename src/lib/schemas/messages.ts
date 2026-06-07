import { z } from "zod";
import { sendRequestSchema } from "./common";

export const backgroundMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("GET_STATE") }),
  z.strictObject({ type: z.literal("GET_STATE_SUMMARY") }),
  z.strictObject({ type: z.literal("GET_BALANCES") }),
  z.strictObject({
    type: z.literal("CREATE_WALLET"),
    name: z.string(),
    password: z.string(),
    seedPhrase: z.string()
  }),
  z.strictObject({
    type: z.literal("IMPORT_WALLET"),
    name: z.string(),
    password: z.string(),
    seedPhrase: z.string()
  }),
  z.strictObject({ type: z.literal("UNLOCK"), password: z.string() }),
  z.strictObject({
    type: z.literal("SWITCH_WALLET"),
    walletId: z.string().min(1),
    password: z.string()
  }),
  z.strictObject({ type: z.literal("LOCK") }),
  z.strictObject({
    type: z.literal("DELETE_WALLET"),
    walletId: z.string().min(1),
    password: z.string()
  }),
  z.strictObject({ type: z.literal("ADD_ACCOUNT"), walletId: z.string().min(1) }),
  z.strictObject({ type: z.literal("REFRESH") }),
  z.strictObject({ type: z.literal("APPROVE_DAPP"), origin: z.string().min(1), accountIndex: z.number().int().min(0), accountIndexes: z.array(z.number().int().min(0)).min(1).optional() }),
  z.strictObject({ type: z.literal("REJECT_DAPP"), origin: z.string().min(1) }),
  z.strictObject({ type: z.literal("REVOKE_DAPP"), origin: z.string().min(1) }),
  z.strictObject({ type: z.literal("APPROVE_SIGNATURE"), id: z.string().min(1) }),
  z.strictObject({ type: z.literal("REJECT_SIGNATURE"), id: z.string().min(1) }),
  z.strictObject({ type: z.literal("APPROVE_DAPP_TRANSACTION"), id: z.string().min(1) }),
  z.strictObject({ type: z.literal("REJECT_DAPP_TRANSACTION"), id: z.string().min(1) }),
  z.strictObject({ type: z.literal("SEND"), request: sendRequestSchema }),
  z.strictObject({
    type: z.literal("SET_RPC_OVERRIDE"),
    chain: z.enum(["bitcoin", "spark", "ethereum", "polygon", "arbitrum", "plasma", "solana"]),
    url: z.string().min(1).optional()
  }),
  z.strictObject({ type: z.literal("OPEN_QR_SCANNER") }),
  z.strictObject({ type: z.literal("SUBMIT_QR_SCAN"), value: z.string().min(1) }),
  z.strictObject({ type: z.literal("TAKE_QR_SCAN") }),
  z.strictObject({
    type: z.literal("DAPP_REQUEST"),
    method: z.string().min(1),
    params: z.unknown().optional()
  })
]);

export type BackgroundMessage = z.infer<typeof backgroundMessageSchema>;

export function parseBackgroundMessage(input: unknown): BackgroundMessage {
  const result = backgroundMessageSchema.safeParse(input);
  if (!result.success) throw new Error("Invalid background message");
  return result.data;
}
