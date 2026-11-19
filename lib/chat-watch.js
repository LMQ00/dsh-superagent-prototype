import { d as key, i as sourceContext, r as health, t as KV } from "./kv-CGgt7p3B.js";
import { join } from "node:path";
import { z } from "zod";
import { appendFile, mkdir, readFile } from "node:fs/promises";
//#region src/sources/chat.ts
const SOURCE = "chat";
/** The single sender this Source speaks for: the person at this machine typing in a main Session. */
const OPERATOR = "operator";
/** The text of a user message, with the blocks that carry no words left out. */
function messageText(message) {
	return message.content.flatMap((block) => block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n").trim();
}
/** True for a message this installation itself delivered into the Session, which is never a person's request. */
function ownMessage(source) {
	return !!source && (source.kind === "dsh-superagent" || source.kind === "plugin" && source.plugin === "dsh-superagent");
}
/** The project the person chose for a conversation, when the selection still names one. */
function selectedProject(source, sessionId) {
	const project = source.state.get(KV.sessions.project(sessionId));
	return typeof project === "string" && project.trim() ? project : void 0;
}
/** Builds the Trigger for one message of a main Session; each message is a Thread of its own, with the conversation's project when one is selected. */
function chatTrigger(messageId, sessionId, text, at, project) {
	return {
		id: key("chat-message", sessionId, messageId),
		source: SOURCE,
		threads: [{
			source: SOURCE,
			id: messageId
		}],
		actor: {
			source: SOURCE,
			id: OPERATOR
		},
		human: true,
		addressed: "direct",
		at,
		text,
		channel: chatChannel(messageId),
		meta: {
			messageId,
			sessionId,
			...project ? { project } : {}
		}
	};
}
const chatChannel = (messageId) => ({
	source: SOURCE,
	thread: `${SOURCE}:${messageId}`,
	address: { message: messageId }
});
/** Appends one user-facing message to `<stateDir>/outbox/chat.md`, once per message id; the panel shows the same text on its ticket. */
async function sendChat(host, message) {
	const dir = join(host.commands.deployment.stateDir, "outbox");
	const file = join(dir, "chat.md");
	const marker = `<!-- dsh-superagent:${message.id} -->`;
	await mkdir(dir, { recursive: true });
	if ((await readFile(file, "utf8").catch(() => "")).includes(marker)) return "sent";
	await appendFile(file, `\n---\n\n${message.text}\n\n${marker}\n`, "utf8");
	return "sent";
}
const chatLink = (address) => ({
	url: "",
	label: {
		zh: `主对话的消息 ${address.message ?? ""}`,
		en: `Message ${address.message ?? ""} in the main Session`
	}
});
const chatKind = {
	kind: SOURCE,
	title: {
		zh: "主对话",
		en: "Main Session"
	},
	description: {
		zh: "主 Session 里这个人说的话就是入口：每条消息是一个候选，主 Session 判断后决定接成工单、并到已有工单、还是忽略。不需要任何账号或消息平台。",
		en: "What the person writes in a main Session is the intake: every message becomes a candidate, and the main Session decides whether to accept it as a ticket, attach it to one, or ignore it. No account or messaging platform is involved."
	},
	schema: z.object({}).strict(),
	fields: [],
	health: ["chat"],
	channel: {
		send: sendChat,
		link: chatLink
	},
	policy: {
		schema: z.object({ allowed: z.array(z.object({
			id: z.string().trim().min(1).max(200),
			name: z.string().trim().max(100).optional()
		}).strict()).default([]) }).strict(),
		fields: [{
			key: "allowed",
			type: "rows",
			label: {
				zh: "能在主对话里发起工作的人",
				en: "People who may originate work in the main Session"
			},
			hint: {
				zh: "主对话只有一个固定身份 operator（就是这台机器前的人）。",
				en: "The main Session has one fixed identity, operator: the person at this machine."
			},
			columns: [{
				key: "id",
				type: "text",
				label: {
					zh: "身份",
					en: "Identity"
				}
			}]
		}],
		explicit: {
			zh: "名单里的身份在主对话里直接说话。",
			en: "An identity on the list writes in the main Session."
		}
	}
};
const name = "dsh-superagent-chat";
const inject = ["orchestrator"];
function apply(ctx) {
	ctx.effect(() => ctx.orchestrator.sources.register(chatKind), "chat: source kind");
	ctx.effect(() => {
		const source = sourceContext(ctx.orchestrator, chatKind);
		const held = [];
		let ready = false;
		source.ready.then(() => {
			ready = true;
			if (!source.configured()) {
				source.report("chat", health("paused", "sourceOff"));
				return;
			}
			for (const trigger of held.splice(0)) source.receive(trigger);
			source.report("chat", health("ready", "chatSession"));
		}).catch(() => {});
		const listener = ctx.on("session/event", (session, event) => {
			if (event.type !== "user/message" || !ctx.orchestrator.isMain(String(session.id))) return;
			const message = event.data;
			if (message.role !== "user" || ownMessage(message.source)) return;
			const text = messageText(message);
			if (!text) return;
			const trigger = chatTrigger(String(message.id), String(session.id), text, (/* @__PURE__ */ new Date()).toISOString(), selectedProject(source, String(session.id)));
			source.atomic(() => source.threads.describe(`${SOURCE}:${trigger.meta.messageId}`, { label: text.slice(0, 80) }));
			if (ready && source.configured()) source.receive(trigger);
			else held.push(trigger);
		});
		return () => {
			listener();
		};
	});
}
//#endregion
export { OPERATOR, SOURCE, apply, chatChannel, chatKind, chatLink, chatTrigger, inject, messageText, name, ownMessage, selectedProject, sendChat };
