declare var acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();
import { marked } from "marked";

//-------------------------------------------------------
// Interfaces
//-------------------------------------------------------

interface ExtensionMessage {
	type: string;
	value?: any;
	sender?: "user" | "bot";
	isLoading?: boolean;
	initialChunk?: string;
	chunk?: string;
	fullResponse?: string;
}

//-------------------------------------------------------
// DOM Elements
//-------------------------------------------------------

const chatContainer = document.getElementById("chat-container") as HTMLDivElement | null;
const messageInput = document.getElementById("message-input") as HTMLTextAreaElement | null;
const sendButton = document.getElementById("send-button") as HTMLButtonElement | null;
const diagnosticsButton = document.getElementById("get-diagnostics-button") as HTMLButtonElement | null;
const contextCheckbox = document.getElementById("include-context-checkbox") as HTMLInputElement | null;

//-------------------------------------------------------
// State Variables
//-------------------------------------------------------

let currentBotStreamElement: HTMLDivElement | null = null;
let currentBotMarkdownContent: string = "";
let thinkingMessageElement: HTMLDivElement | null = null;

//-------------------------------------------------------
// Helper Functions
//-------------------------------------------------------

function autoResizeTextarea(): void {
	if (messageInput) {
		messageInput.style.height = "auto";
		messageInput.style.height = messageInput.scrollHeight + "px";
	}
}

function renderMarkdown(element: HTMLElement, markdownText: string): void {
	try {
		element.innerHTML = marked.parse(markdownText) as string;
	} catch (e) {
		console.error("[Maple-Code] Markdown parsing error during render:", e);
		element.textContent = markdownText;
	}
}

function addCompleteMessage(text: string, sender: "user" | "bot", isError: boolean = false): void {
	if (!chatContainer) return;
	const messageElement = document.createElement("div");
	messageElement.classList.add("message");
	messageElement.classList.add(sender === "user" ? "user-message" : "bot-message");
	if (isError) messageElement.classList.add("error-message");

	if (sender === "bot") {
		renderMarkdown(messageElement, text);
	} else {
		messageElement.textContent = text;
	}
	chatContainer.appendChild(messageElement);
	scrollToBottom();
}

function showThinkingMessage(text: string = "Maple is thinking..."): void {
	if (!chatContainer) return;
	clearThinkingMessage();
	thinkingMessageElement = document.createElement("div");
	thinkingMessageElement.classList.add("message", "bot-message", "loading-message");
	thinkingMessageElement.textContent = text;
	chatContainer.appendChild(thinkingMessageElement);
	scrollToBottom();
}

function clearThinkingMessage(): void {
	if (thinkingMessageElement) {
		thinkingMessageElement.remove();
		thinkingMessageElement = null;
	}
}

function startBotStream(initialChunk: string): void {
	if (!chatContainer) return;
	clearThinkingMessage();
	currentBotStreamElement = null;
	currentBotMarkdownContent = "";

	currentBotStreamElement = document.createElement("div");
	currentBotStreamElement.classList.add("message", "bot-message");

	currentBotMarkdownContent = initialChunk;
	renderMarkdown(currentBotStreamElement, currentBotMarkdownContent);

	chatContainer.appendChild(currentBotStreamElement);
	scrollToBottom();
}

function appendBotStream(chunk: string): void {
	if (currentBotStreamElement) {
		currentBotMarkdownContent += chunk;
		renderMarkdown(currentBotStreamElement, currentBotMarkdownContent);
		scrollToBottom();
	} else {
		console.warn("[Maple-Code] Append called without an active stream element, attempting to start new stream.");
		startBotStream(chunk);
	}
}

function endBotStream(fullResponse: string | undefined): void {
	if (currentBotStreamElement && fullResponse !== undefined) {
		renderMarkdown(currentBotStreamElement, fullResponse);
	} else if (!currentBotStreamElement) {
		console.warn("[Maple-Code] End stream called without an active stream element.");
	}
	currentBotStreamElement = null;
	currentBotMarkdownContent = "";
	scrollToBottom();
}

function scrollToBottom(): void {
	if (chatContainer) {
		setTimeout(() => {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}, 0);
	}
}

function sendMessageHandler(): void {
	if (!messageInput || !contextCheckbox || !sendButton) {
		console.warn("[Maple-Code] sendMessageHandler: Missing one or more DOM elements. Cannot send message.");
		return;
	}
	const messageText = messageInput.value.trim();
	if (messageText && !sendButton.disabled) {
		addCompleteMessage(messageText, "user");
		const includeContext = contextCheckbox.checked;
		vscode.postMessage({ type: "message", value: messageText, includeContext });
		messageInput.value = "";
		autoResizeTextarea();
		messageInput.disabled = true;
		sendButton.disabled = true;
		contextCheckbox.disabled = true;
	}
}

function enableInput(): void {
	if (messageInput) messageInput.disabled = false;
	if (sendButton) sendButton.disabled = false;
	if (contextCheckbox) contextCheckbox.disabled = false;
}

//-------------------------------------------------------
// Event Listeners
//-------------------------------------------------------

if (messageInput) {
	messageInput.addEventListener("input", autoResizeTextarea);
	messageInput.addEventListener("keydown", (event: KeyboardEvent) => {
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			sendMessageHandler();
		}
	});
}

if (sendButton) {
	sendButton.addEventListener("click", sendMessageHandler);
}

if (diagnosticsButton) {
	diagnosticsButton.addEventListener("click", () => {
		// @ts-ignore
		vscode.postMessage({ type: "getDiagnostics" });
	});
}

//-------------------------------------------------------
// Handle Messages from Extension
//-------------------------------------------------------

// @ts-ignore
window.addEventListener("message", (event: MessageEvent<ExtensionMessage>) => {
	const message = event.data;
	switch (message.type) {
		case "addMessage":
			if (message.isLoading) {
				showThinkingMessage(message.value);
			} else {
				clearThinkingMessage();
				addCompleteMessage(
					message.value || "Received empty message.",
					message.sender || "bot",
					message.value?.toLowerCase().includes("error")
				);
				enableInput();
			}
			break;
		case "clearLastBotMessage":
			clearThinkingMessage();
			break;
		case "startBotStream":
			clearThinkingMessage();
			startBotStream(message.initialChunk || "");
			break;
		case "appendBotStream":
			appendBotStream(message.chunk || "");
			break;
		case "endBotStream":
			endBotStream(message.fullResponse);
			enableInput();
			break;
		case "diagnostics":
			let diagText = "```text\nDiagnostics:\n";
			if (!message.value || !Array.isArray(message.value) || message.value.length === 0) {
				diagText += "No diagnostics found.\n";
			} else {
				message.value.forEach((fileDiag: any) => {
					diagText += `\nFile: ${fileDiag.uri}\n`;
					if (fileDiag.diagnostics && Array.isArray(fileDiag.diagnostics)) {
						fileDiag.diagnostics.forEach((d: any) => {
							diagText += `  - [${d.severity}] ${d.message} (L${d.range.start.line + 1})\n`;
						});
					}
				});
			}
			diagText += "```";
			addCompleteMessage(diagText, "bot");
			enableInput();
			break;
		default:
			console.warn("[Maple-Code] Webview received unknown message type: ", message.type);
	}
});
