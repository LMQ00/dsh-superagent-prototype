import { S as ChannelRef, U as Trigger, l as OutboundMessage } from "./intake-CtpCpX2i.js";
import { _ as SourceKind, g as ChannelLink, n as SourceContext } from "./host-DF-plY0w.js";
import { Context } from "@deepseek-ai/cordis";
//#region src/sources/chat.d.ts
declare const SOURCE = "chat";
/** The single sender this Source speaks for: the person at this machine typing in a main Session. */
declare const OPERATOR = "operator";
/** The text of a user message, with the blocks that carry no words left out. */
declare function messageText(message: {
  content: readonly {
    type: string;
    text?: string;
  }[];
}): string;
/** True for a message this installation itself delivered into the Session, which is never a person's request. */
declare function ownMessage(source: {
  kind: string;
  plugin?: unknown;
} | undefined): boolean;
/** The project the person chose for a conversation, when the selection still names one. */
declare function selectedProject(source: Pick<SourceContext, 'state'>, sessionId: string): string | undefined;
/** Builds the Trigger for one message of a main Session; each message is a Thread of its own, with the conversation's project when one is selected. */
declare function chatTrigger(messageId: string, sessionId: string, text: string, at: string, project?: string): Trigger;
declare const chatChannel: (messageId: string) => ChannelRef;
/** Appends one user-facing message to `<stateDir>/outbox/chat.md`, once per message id; the panel shows the same text on its ticket. */
declare function sendChat(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'>;
declare const chatLink: (address: Record<string, string>) => ChannelLink;
declare const chatKind: SourceKind;
declare const name = "dsh-superagent-chat";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { OPERATOR, SOURCE, apply, chatChannel, chatKind, chatLink, chatTrigger, inject, messageText, name, ownMessage, selectedProject, sendChat };