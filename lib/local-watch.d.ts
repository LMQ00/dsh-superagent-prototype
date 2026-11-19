import { S as ChannelRef, U as Trigger, l as OutboundMessage } from "./intake-RyAhh43I.js";
import { _ as SourceKind, g as ChannelLink, n as SourceContext, t as Health } from "./host-DFS8_Rah.js";
import { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
//#region src/sources/local.d.ts
declare const SOURCE = "local";
/** The single identity this Source speaks for: the person at this machine. It matches the default Policy of a local installation. */
declare const OPERATOR = "operator";
declare const LocalConfigSchema: z.ZodObject<{
  inbox: z.ZodDefault<z.ZodString>;
  pollSeconds: z.ZodDefault<z.ZodNumber>;
  failuresBeforeError: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
type LocalConfig = z.infer<typeof LocalConfigSchema>;
/** The inbox directory a configuration names, or `<stateDir>/inbox` by default. */
declare const inboxDirectory: (config: Pick<LocalConfig, "inbox">, stateDir: string) => string;
declare const localChannel: (file: string) => ChannelRef;
/**
 * Builds the Trigger for one inbox file. The file is a Thread and its content the request, so editing it again is a
 * follow-up on the same Thread; the id follows the content, so unchanged text is never ingested twice.
 */
declare function localTrigger(file: string, text: string, at: string, path: string): Trigger;
/** Appends one user-facing message to `<stateDir>/outbox/<thread>.md`, once per message id. */
declare function sendLocal(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'>;
declare function localLink(address: Record<string, string>): ChannelLink;
declare const localKind: SourceKind<LocalConfig>;
declare const name = "dsh-superagent-local";
declare const inject: string[];
declare function apply(ctx: Context): void;
/** Returns an error health once `failures` consecutive scans fail, or undefined so a single failure stays quiet. */
declare function pollFailure(failures: number, threshold: number, error: unknown): Health | undefined;
//#endregion
export { LocalConfig, OPERATOR, SOURCE, apply, inboxDirectory, inject, localChannel, localKind, localLink, localTrigger, name, pollFailure, sendLocal };