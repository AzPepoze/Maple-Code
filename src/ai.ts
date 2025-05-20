import * as vscode from "vscode";
import {
	Content,
	GenerationConfig,
	GoogleGenAI,
	HarmBlockThreshold,
	HarmCategory,
	Part,
	SafetySetting,
	Tool,
	Type,
} from "@google/genai";
import { SidebarProvider } from "./sidebarProvider";
import { loadInstructionFile } from "./dataLoader";
import * as path from "path";
import { toolFunctions } from "./tools";

const toolsInstruction = `
You DO NOT have the ability to execute file system operations directly. Instead, you should describe the file operations you would perform by outputting them as XML-like text directly in your response.
The system will then parse this XML-like text and execute the corresponding tool.

- To indicate reading a file, output: \`<read_file file="path/to/file.ext" />\`
- To indicate writing to a file, output: \`<write_file file="path/to/file.ext">\\nCONTENT_GOES_HERE\\n</write_file>\`

When you need to perform a file operation, output it in this format directly as part of your text response. Do not expect any execution. Just describe it.
For \`write_file\`, ensure \`CONTENT_GOES_HERE\` contains the full, complete content for the file, not just a diff or partial update.
`;

//-------------------------------------------------------
// Type Definition for AI Model Configuration
//-------------------------------------------------------

export interface AiModelConfig {
	client: GoogleGenAI;
	modelName: string;
	safetySettings: SafetySetting[];
	tools: Tool[];
	generationConfig: GenerationConfig;
}

//-------------------------------------------------------
// Constants
//-------------------------------------------------------
const WEBVIEW_MESSAGE_TYPES = {
	ADD_MESSAGE: "addMessage",
	CLEAR_LAST_BOT_MESSAGE: "clearLastBotMessage",
	START_BOT_STREAM: "startBotStream",
	APPEND_BOT_STREAM: "appendBotStream",
	END_BOT_STREAM: "endBotStream",
} as const;

const BOT_SENDER_NAME = "bot";
const USER_SENDER_NAME = "user";
const MODEL_ROLE_NAME = "model";
const FUNCTION_ROLE_NAME = "function";

//-------------------------------------------------------
// Global State
//-------------------------------------------------------
const chatHistory: Content[] = [];

//-------------------------------------------------------
// VS Code Context Gathering
//-------------------------------------------------------

export function getCurrentFileContext(): {
	fileName: string;
	fileContent: string;
	languageId: string;
	cursorPosition: vscode.Position;
} | null {
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const document = editor.document;
		const MAX_CHARS_AROUND_CURSOR = 2000;
		const position = editor.selection.active;
		const startOffset = Math.max(0, document.offsetAt(position) - MAX_CHARS_AROUND_CURSOR / 2);
		const endOffset = Math.min(
			document.getText().length,
			document.offsetAt(position) + MAX_CHARS_AROUND_CURSOR / 2
		);
		const startPos = document.positionAt(startOffset);
		const endPos = document.positionAt(endOffset);
		const contextText = document.getText(new vscode.Range(startPos, endPos));

		return {
			fileName: path.basename(document.fileName),
			fileContent: contextText,
			languageId: document.languageId,
			cursorPosition: position,
		};
	}
	return null;
}

//-------------------------------------------------------
// AI API Initialization
//-------------------------------------------------------

let ai: GoogleGenAI | undefined;

const modelName = "gemini-2.5-flash-preview-05-20";

const safetySettings: SafetySetting[] = [
	{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const tools: Tool[] = [
	{
		functionDeclarations: [
			{
				name: "read_file",
				description: "Reads content of a file. Provide file path (relative to workspace/file or absolute).",
				parameters: {
					type: Type.OBJECT,
					properties: { filePath: { type: Type.STRING, description: "Path to file." } },
					required: ["filePath"],
				},
			},
			{
				name: "write_file",
				description:
					"Writes content to a file. Provide file path (relative to workspace/file or absolute).",
				parameters: {
					type: Type.OBJECT,
					properties: {
						filePath: { type: Type.STRING, description: "Path to file." },
						content: { type: Type.STRING, description: "Content to write." },
					},
					required: ["filePath", "content"],
				},
			},
		],
	},
];

const generationConfig: GenerationConfig = {
	temperature: 1,
};

export async function initializeAiModel(apiKey: string) {
	if (!apiKey) {
		vscode.window.showErrorMessage("AI API key is missing.");
		return undefined;
	}
	try {
		ai = new GoogleGenAI({ apiKey });
		console.log("[Maple-Code] AI Model Configured successfully.");
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to initialize AI API: ${error.message}`);
		console.error("[Maple-Code] AI Initialization Error:", error);
		return undefined;
	}
}

//-------------------------------------------------------
// Private Helper: AI Interaction Handler
//-------------------------------------------------------

function extractToolCallsFromText(fullText: string): { name: string; args: Record<string, any>; rawMatch: string }[] {
	const toolCalls: { name: string; args: Record<string, any>; rawMatch: string }[] = [];
	const combinedRegex =
		/(<read_file file="([^"]+)"\s*\/>)|(<write_file file="([^"]+)">\s*([\s\S]*?)\s*<\/write_file>)/g;

	let match;
	while ((match = combinedRegex.exec(fullText)) !== null) {
		let toolName = "";
		let toolArgs: Record<string, any> = {};
		let rawMatch = match[0];

		if (match[1]) {
			toolName = "read_file";
			toolArgs = { filePath: match[2] };
		} else if (match[3]) {
			toolName = "write_file";
			toolArgs = { filePath: match[4], content: match[5] };
		}

		if (toolName) {
			toolCalls.push({ name: toolName, args: toolArgs, rawMatch: rawMatch });
		}
	}
	return toolCalls;
}

async function executeAndRecordToolCall(
	toolName: string,
	toolArgs: Record<string, any>,
	sidebarProvider: SidebarProvider
) {
	console.log(`[Maple-Code] Executing parsed tool: ${toolName} with args:`, toolArgs);
	sidebarProvider._postMessageSafe({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });
	sidebarProvider._postMessageSafe({
		type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
		value: `Executing parsed tool: \`${toolName}(...)\`...`,
		sender: BOT_SENDER_NAME,
		isLoading: true,
	});

	let functionResultPayload: any;
	try {
		const func = (toolFunctions as any)[toolName];
		if (typeof func === "function") {
			functionResultPayload = await func(toolArgs);
		} else {
			functionResultPayload = `Error: Tool function '${toolName}' not found or not callable.`;
		}
	} catch (e: any) {
		console.error(`[Maple-Code] Runtime error executing parsed tool '${toolName}':`, e);
		functionResultPayload = `Runtime error in parsed tool '${toolName}': ${e.message}`;
	}

	console.log(`[Maple-Code] Parsed tool '${toolName}' result:`, functionResultPayload);

	const functionResponsePart: Part = {
		functionResponse: {
			name: toolName,
			response: {
				name: toolName,
				content:
					typeof functionResultPayload === "string"
						? functionResultPayload
						: JSON.stringify(functionResultPayload),
			},
		},
	};

	chatHistory.push({ role: FUNCTION_ROLE_NAME, parts: [functionResponsePart] });
}

async function _handleGenerativeAiRequest(sidebarProvider: SidebarProvider) {
	if (!ai) {
		console.error("[Maple-Code] _handleGenerativeAiRequest: AI model not initialized.");
		sidebarProvider._postMessageSafe({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: "Error: AI model not initialized. Please check your settings and API key.",
			sender: BOT_SENDER_NAME,
		});
		return;
	}

	if (!sidebarProvider._view) {
		console.error("[Maple-Code] _handleGenerativeAiRequest: Sidebar view is not available.");
		vscode.window.showErrorMessage("Maple Code chat view is not available.");
		return;
	}

	const lastHistoryEntry = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
	if (lastHistoryEntry?.role === USER_SENDER_NAME) {
		sidebarProvider._postMessageSafe({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: "Maple is thinking...",
			sender: BOT_SENDER_NAME,
			isLoading: true,
		});
	}

	try {
		const instructionContent = await loadInstructionFile("Instruction.md");
		let systemInstructionText = instructionContent || "";

		systemInstructionText += toolsInstruction;

		const systemInstruction: Part | undefined = systemInstructionText
			? { text: `System Instructions:\n${systemInstructionText}` }
			: undefined;

		const result = await ai.models.generateContentStream({
			model: modelName,
			contents: chatHistory,
			config: {
				safetySettings: safetySettings,
				systemInstruction: systemInstruction,
			},
		});

		sidebarProvider._postMessageSafe({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });

		let isFirstTextChunkInResponse = true;
		let accumulatedTextForThisTurn = "";

		for await (const chunk of result) {
			const candidate = chunk.candidates?.[0];
			if (!candidate?.content?.parts) continue;

			for (const part of candidate.content.parts) {
				if (part.text) {
					accumulatedTextForThisTurn += part.text;
					if (isFirstTextChunkInResponse) {
						sidebarProvider._postMessageSafe({
							type: WEBVIEW_MESSAGE_TYPES.START_BOT_STREAM,
							initialChunk: part.text,
						});
						isFirstTextChunkInResponse = false;
					} else {
						sidebarProvider._postMessageSafe({
							type: WEBVIEW_MESSAGE_TYPES.APPEND_BOT_STREAM,
							chunk: part.text,
						});
					}
				}
			}

			const toolCallsToExecute = extractToolCallsFromText(accumulatedTextForThisTurn);

			if (toolCallsToExecute.length > 0) {
				chatHistory.push({ role: MODEL_ROLE_NAME, parts: [{ text: accumulatedTextForThisTurn }] });

				sidebarProvider._postMessageSafe({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });

				for (const toolCall of toolCallsToExecute) {
					accumulatedTextForThisTurn = accumulatedTextForThisTurn.replace(toolCall.rawMatch, "").trim();

					await executeAndRecordToolCall(toolCall.name, toolCall.args, sidebarProvider);
				}

				await _handleGenerativeAiRequest(sidebarProvider);
				return;
			}
		}

		if (!isFirstTextChunkInResponse) {
			sidebarProvider._postMessageSafe({
				type: WEBVIEW_MESSAGE_TYPES.END_BOT_STREAM,
				fullResponse: accumulatedTextForThisTurn,
			});
		} else if (accumulatedTextForThisTurn) {
			sidebarProvider._postMessageSafe({
				type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
				value: accumulatedTextForThisTurn,
				sender: BOT_SENDER_NAME,
			});
		}

		if (accumulatedTextForThisTurn) {
			chatHistory.push({ role: MODEL_ROLE_NAME, parts: [{ text: accumulatedTextForThisTurn }] });
		}

		console.log("[Maple-Code] AI turn complete. History:", JSON.stringify(chatHistory.slice(-2), null, 2));
	} catch (error: any) {
		const errorMessage = `Error processing AI request: ${error.message || String(error)}`;
		console.error(`[Maple-Code] ${errorMessage}`, error);
		vscode.window.showErrorMessage(errorMessage);
		sidebarProvider._postMessageSafe({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });
		sidebarProvider._postMessageSafe({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: `Sorry, an error occurred: ${errorMessage}`,
			sender: BOT_SENDER_NAME,
		});
		chatHistory.push({ role: MODEL_ROLE_NAME, parts: [{ text: `Error: ${errorMessage}` }] });
	}
}

//-------------------------------------------------------
// Process Chat Message (from Webview)
//-------------------------------------------------------
export async function askAI({
	userPrompt,
	includeContext,
	sidebarProvider,
}: {
	userPrompt: string;
	includeContext: boolean;
	sidebarProvider: SidebarProvider;
}) {
	if (!ai) {
		console.error("[Maple-Code] askAI: AI model not initialized.");
		sidebarProvider._postMessageSafe({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: "Error: AI model not initialized. Please check your settings and API key.",
			sender: BOT_SENDER_NAME,
		});
		return;
	}

	if (!sidebarProvider._view) {
		console.error("[Maple-Code] askAI: Sidebar view is not available.");
		vscode.window.showErrorMessage("Cannot process message: Chat view is not ready.");
		return;
	}

	const userMessageParts: Part[] = [];

	if (includeContext) {
		const contextInfo = getCurrentFileContext();
		if (contextInfo) {
			userMessageParts.push({
				text: JSON.stringify(contextInfo, null, 2),
			});
			sidebarProvider._postMessageSafe({
				type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
				value: `Included context from '${contextInfo.fileName}'.`,
				sender: BOT_SENDER_NAME,
			});
		} else {
			sidebarProvider._postMessageSafe({
				type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
				value: "Info: Could not get context from active editor.",
				sender: BOT_SENDER_NAME,
			});
		}
	}

	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const selection = editor.selection;
		if (!selection.isEmpty) {
			const selectedText = editor.document.getText(selection);
			if (selectedText.trim()) {
				const context = `Selected from '${path.basename(editor.document.fileName)}':\n\`\`\`${
					editor.document.languageId
				}\n${selectedText}\n\`\`\`\n`;
				userMessageParts.push({ text: context });
				sidebarProvider._postMessageSafe({
					type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
					value: `You included selection:\n\`\`\`...\n${selectedText.substring(0, 100)}...\n\`\`\``,
					sender: USER_SENDER_NAME,
				});
			}
		}
	}

	userMessageParts.push({ text: userPrompt });

	chatHistory.push({ role: USER_SENDER_NAME, parts: userMessageParts });
	console.log("[Maple-Code] User message added to history. Length:", chatHistory.length);

	await _handleGenerativeAiRequest(sidebarProvider);
}
