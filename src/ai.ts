import * as vscode from "vscode";
import {
	Content,
	FunctionCall,
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
import * as fs from "fs/promises";
import * as path from "path";

/*
------------------------------------------------------
Type Definition for AI Model Configuration
-------------------------------------------------------
*/
// Define a type for the AI model configuration to be passed around
export interface AiModelConfig {
	client: GoogleGenAI; // The main client
	modelName: string;
	safetySettings: SafetySetting[];
	tools: Tool[];
	generationConfig: GenerationConfig;
}

/*
------------------------------------------------------
Constants
-------------------------------------------------------
*/
const WEBVIEW_MESSAGE_TYPES = {
	ADD_MESSAGE: "addMessage",
	CLEAR_LAST_BOT_MESSAGE: "clearLastBotMessage",
	START_BOT_STREAM: "startBotStream",
	APPEND_BOT_STREAM: "appendBotStream",
	END_BOT_STREAM: "endBotStream",
} as const;

const BOT_SENDER_NAME = "bot";
const USER_SENDER_NAME = "user";
const SYSTEM_ROLE_NAME = "system"; // Role for system instructions (often "system" or "user" depending on API part)
const MODEL_ROLE_NAME = "model";
const FUNCTION_ROLE_NAME = "function"; // Role for function responses from your tools

/*
------------------------------------------------------
Global State
-------------------------------------------------------
*/
const chatHistory: Content[] = []; // Use Content type from @google/genai

/*
------------------------------------------------------
File Operation Tools (Copied from previous, ensure compatibility)
-------------------------------------------------------
*/
async function readFile(filePath: string): Promise<string> {
	try {
		const activeEditor = vscode.window.activeTextEditor;
		let absolutePath = filePath;

		if (activeEditor && !path.isAbsolute(filePath)) {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
			if (workspaceFolder) {
				absolutePath = path.join(workspaceFolder.uri.fsPath, filePath);
			} else {
				const currentFileDir = path.dirname(activeEditor.document.uri.fsPath);
				absolutePath = path.join(currentFileDir, filePath);
				if (
					!(await fs
						.stat(absolutePath)
						.then((s) => s.isFile())
						.catch(() => false))
				) {
					return `Error: File not found at ${absolutePath} (relative to current file). Please provide an absolute path or ensure the file exists in the workspace.`;
				}
			}
		} else if (!path.isAbsolute(filePath)) {
			return `Error: Cannot determine absolute path for relative path "${filePath}" without an active editor or workspace. Please provide an absolute path.`;
		}

		if (
			!(await fs
				.stat(absolutePath)
				.then((s) => s.isFile())
				.catch(() => false))
		) {
			return `Error: File not found at ${absolutePath}`;
		}
		console.log(`[Maple-Code] Reading file from: ${absolutePath}`);
		const content = await fs.readFile(absolutePath, "utf-8");
		return content;
	} catch (error: any) {
		console.error(`[Maple-Code] Error reading file ${filePath}:`, error);
		return `Error reading file '${filePath}': ${error.message}`;
	}
}

interface FileEdit {
	lineNumber: number;
	action: "insert" | "delete" | "replace";
	newContent?: string;
	deleteCount?: number;
}

async function editFile(filePath: string, edits: FileEdit[]): Promise<string> {
	try {
		const activeEditor = vscode.window.activeTextEditor;
		let absolutePath = filePath;

		if (activeEditor && !path.isAbsolute(filePath)) {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
			if (workspaceFolder) {
				absolutePath = path.join(workspaceFolder.uri.fsPath, filePath);
			} else {
				const currentFileDir = path.dirname(activeEditor.document.uri.fsPath);
				absolutePath = path.join(currentFileDir, filePath);
				if (
					!(await fs
						.stat(absolutePath)
						.then((s) => s.isFile())
						.catch(() => false))
				) {
					return `Error: File not found at ${absolutePath} (relative to current file). Please provide an absolute path or ensure the file exists in the workspace.`;
				}
			}
		} else if (!path.isAbsolute(filePath)) {
			return `Error: Cannot determine absolute path for relative path "${filePath}" without an active editor or workspace. Please provide an absolute path.`;
		}

		if (
			!(await fs
				.stat(absolutePath)
				.then((s) => s.isFile())
				.catch(() => false))
		) {
			return `Error: File not found at ${absolutePath}`;
		}
		console.log(`[Maple-Code] Attempting to edit file: ${absolutePath}`);

		const originalContent = await fs.readFile(absolutePath, "utf-8");
		let lines = originalContent.split(/\r?\n/);

		edits.sort((a, b) => b.lineNumber - a.lineNumber);

		for (const edit of edits) {
			const zeroBasedLineNumber = edit.lineNumber - 1;

			if (edit.action === "insert" && edit.lineNumber === lines.length + 1 && edit.newContent !== undefined) {
				lines.push(edit.newContent);
				console.log(`[Maple-Code] editFile: Inserted at end: "${edit.newContent}"`);
				continue;
			}
			if (
				zeroBasedLineNumber < 0 ||
				(zeroBasedLineNumber >= lines.length &&
					!(edit.action === "insert" && zeroBasedLineNumber === lines.length))
			) {
				console.warn(
					`[Maple-Code] editFile: Invalid line number ${edit.lineNumber} for ${lines.length} lines (action: ${edit.action}). Skipping.`
				);
				continue;
			}
			switch (edit.action) {
				case "insert":
					if (edit.newContent !== undefined) lines.splice(zeroBasedLineNumber, 0, edit.newContent);
					break;
				case "delete":
					lines.splice(
						zeroBasedLineNumber,
						edit.deleteCount !== undefined && edit.deleteCount > 0 ? edit.deleteCount : 1
					);
					break;
				case "replace":
					if (edit.newContent !== undefined) lines[zeroBasedLineNumber] = edit.newContent;
					break;
			}
		}
		const newContent = lines.join("\n");
		const userConfirmation = await vscode.window.showWarningMessage(
			`AI proposes to modify '${path.basename(filePath)}'. Apply changes? File: ${absolutePath}`,
			{ modal: true },
			"Confirm",
			"Cancel"
		);
		if (userConfirmation === "Confirm") {
			await fs.writeFile(absolutePath, newContent, "utf-8");
			console.log(`[Maple-Code] File '${absolutePath}' edited.`);
			try {
				const document = await vscode.workspace.openTextDocument(absolutePath);
				await vscode.window.showTextDocument(document);
			} catch (e) {
				console.warn(`[Maple-Code] Could not open ${absolutePath} after edit:`, e);
			}
			return `File '${filePath}' successfully edited.`;
		} else {
			console.log(`[Maple-Code] Edit for '${absolutePath}' cancelled.`);
			return `File edit for '${filePath}' cancelled.`;
		}
	} catch (error: any) {
		console.error(`[Maple-Code] Error editing file ${filePath}:`, error);
		return `Error editing file '${filePath}': ${error.message}`;
	}
}

/*
------------------------------------------------------
Function Dispatcher (Copied from previous)
-------------------------------------------------------
*/
async function executeFunctionCall(functionCall: FunctionCall) {
	const { name, args } = functionCall;
	let functionResultPayload: any;
	console.log(`[Maple-Code] Executing function: ${name} with args:`, args);

	try {
		if (name === "readFile") {
			functionResultPayload = args?.filePath
				? await readFile(args.filePath as string)
				: "Error: Missing 'filePath' for readFile.";
		} else if (name === "editFile") {
			if (args?.filePath && Array.isArray(args.edits)) {
				const typedEdits = args.edits as FileEdit[];
				const isValidEdits = typedEdits.every(
					(e: any) =>
						typeof e.lineNumber === "number" &&
						e.lineNumber > 0 &&
						["insert", "delete", "replace"].includes(e.action) &&
						(e.action !== "delete" ? typeof e.newContent === "string" : true)
				);
				functionResultPayload = isValidEdits
					? await editFile(args.filePath as string, typedEdits)
					: "Error: Invalid 'edits' structure for editFile.";
			} else {
				functionResultPayload = "Error: Missing 'filePath' or 'edits' for editFile.";
			}
		} else if (name === "exampleTool") {
			functionResultPayload = `Called exampleTool with param1: ${args?.param1 || "N/A"}`;
		} else {
			functionResultPayload = `Error: Unknown function: ${name}`;
		}
	} catch (e: any) {
		console.error(`[Maple-Code] Runtime error in function ${name}:`, e);
		functionResultPayload = `Runtime error in ${name}: ${e.message}`;
	}
	console.log(`[Maple-Code] Function ${name} result:`, functionResultPayload);
	return {
		// This structure should align with @google/genai's FunctionResponsePart
		functionResponse: {
			name,
			response: {
				name,
				content:
					typeof functionResultPayload === "string"
						? functionResultPayload
						: JSON.stringify(functionResultPayload),
			},
		},
	};
}

/*
------------------------------------------------------
AI API Initialization
-------------------------------------------------------
*/

let ai: GoogleGenAI | undefined;

const modelName = "gemini-2.5-flash-preview-04-17";

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
				name: "readFile",
				description: "Reads content of a file. Provide file path (relative to workspace/file or absolute).",
				parameters: {
					type: Type.OBJECT,
					properties: { filePath: { type: Type.STRING, description: "Path to file." } },
					required: ["filePath"],
				},
			},
			{
				name: "editFile",
				description:
					"Edits a file. Provide path and an array of edit objects (lineNumber, action, newContent?, deleteCount?). Process edits bottom-up.",
				parameters: {
					type: Type.OBJECT,
					properties: {
						filePath: { type: Type.STRING, description: "Path to file." },
						edits: {
							type: Type.ARRAY,
							description: "Edit operations.",
							items: {
								type: Type.OBJECT,
								properties: {
									lineNumber: {
										type: Type.NUMBER,
										description: "1-based line number.",
									},
									action: {
										type: Type.STRING,
										enum: ["insert", "delete", "replace"],
									},
									newContent: {
										type: Type.STRING,
										description: "For insert/replace.",
									},
									deleteCount: {
										type: Type.NUMBER,
										description: "For delete.",
									},
								},
								required: ["lineNumber", "action"],
							},
						},
					},
					required: ["filePath", "edits"],
				},
			},
			{
				name: "exampleTool",
				description: "Example tool.",
				parameters: {
					type: Type.OBJECT,
					properties: { param1: { type: Type.STRING } },
					required: ["param1"],
				},
			},
		],
	},
];

const config = {
	safetySettings,
	tools,
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

/*
------------------------------------------------------
Private Helper: AI Interaction Handler
-------------------------------------------------------
*/
async function _handleGenerativeAiRequest(sidebarProvider: SidebarProvider) {
	if (!sidebarProvider._view) {
		console.error("[Maple-Code] _handleGenerativeAiRequest: Sidebar view is not available.");
		vscode.window.showErrorMessage("Maple Code chat view is not available.");
		return;
	}

	sidebarProvider._view.webview.postMessage({
		type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
		value: JSON.stringify(chatHistory, null, 2),
		sender: USER_SENDER_NAME,
	});

	const lastHistoryEntry = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
	if (lastHistoryEntry?.role === USER_SENDER_NAME) {
		sidebarProvider._view.webview.postMessage({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: "API requesting...",
			sender: BOT_SENDER_NAME,
			isLoading: true,
		});
	}

	try {
		const instructionContent = await loadInstructionFile("Instruction.md");
		const systemInstruction: Part | undefined = instructionContent
			? { text: `System Instructions:\n${instructionContent}` }
			: undefined;

		const result = await ai.models.generateContentStream({
			model: modelName,
			contents: chatHistory,
			config: {
				...config,
				systemInstruction,
			},
		});

		sidebarProvider._view.webview.postMessage({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });

		let isFirstTextChunkInResponse = true;
		let accumulatedTextForThisTurn = "";
		let functionCallEncountered: FunctionCall | undefined = undefined;

		for await (const chunk of result) {
			const candidate = chunk.candidates?.[0];
			if (!candidate?.content?.parts) continue;

			if (chunk.text) {
				accumulatedTextForThisTurn += chunk.text;
				if (isFirstTextChunkInResponse) {
					sidebarProvider._view.webview.postMessage({
						type: WEBVIEW_MESSAGE_TYPES.START_BOT_STREAM,
						initialChunk: chunk.text,
					});
					isFirstTextChunkInResponse = false;
				} else {
					sidebarProvider._view.webview.postMessage({
						type: WEBVIEW_MESSAGE_TYPES.APPEND_BOT_STREAM,
						chunk: chunk.text,
					});
				}
			}

			if (chunk.functionCalls && chunk.functionCalls.length > 0) {
				for (const functionCall of chunk.functionCalls) {
					functionCallEncountered = functionCall;
					break; // from functionCalls loop
				}

				break; // from parts loop
			}
		}

		if (!isFirstTextChunkInResponse) {
			sidebarProvider._view.webview.postMessage({
				type: WEBVIEW_MESSAGE_TYPES.END_BOT_STREAM,
				fullResponse: accumulatedTextForThisTurn,
			});
		} else if (accumulatedTextForThisTurn) {
			sidebarProvider._view.webview.postMessage({
				type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
				value: accumulatedTextForThisTurn,
				sender: BOT_SENDER_NAME,
			});
		}

		const modelResponseToStore: Part[] = [];
		if (accumulatedTextForThisTurn) modelResponseToStore.push({ text: accumulatedTextForThisTurn });
		if (functionCallEncountered) modelResponseToStore.push({ functionCall: functionCallEncountered });

		if (modelResponseToStore.length > 0) {
			chatHistory.push({ role: MODEL_ROLE_NAME, parts: modelResponseToStore });
		}

		if (functionCallEncountered) {
			console.log(
				`[Maple-Code] AI requests call: ${functionCallEncountered.name}`,
				functionCallEncountered.args
			);
			sidebarProvider._view.webview.postMessage({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });
			sidebarProvider._view.webview.postMessage({
				type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
				value: `Calling: \`${functionCallEncountered.name}(...)\`...`,
				sender: BOT_SENDER_NAME,
				isLoading: true,
			});

			const functionResponsePart = await executeFunctionCall(functionCallEncountered);
			chatHistory.push({ role: FUNCTION_ROLE_NAME, parts: [functionResponsePart] });

			sidebarProvider._view.webview.postMessage({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });
			sidebarProvider._view.webview.postMessage({
				type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
				value: `Result for \`${functionCallEncountered.name}\`:\n\`\`\`\n${String(
					functionResponsePart.functionResponse.response.content
				).substring(0, 200)}...\n\`\`\``,
				sender: BOT_SENDER_NAME,
			});

			return;
		}
		// console.log("[Maple-Code] End of _handleGenerativeAiRequest. History:", JSON.stringify(chatHistory.slice(-2),null,2));
	} catch (error: any) {
		const errorMessage = `Error processing AI request: ${error.message || String(error)}`;
		console.error(`[Maple-Code] ${errorMessage}`, error);
		vscode.window.showErrorMessage(errorMessage);
		sidebarProvider._view.webview.postMessage({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });
		sidebarProvider._view.webview.postMessage({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: `Sorry, an error occurred: ${errorMessage}`,
			sender: BOT_SENDER_NAME,
		});
		chatHistory.push({ role: MODEL_ROLE_NAME, parts: [{ text: `Error: ${errorMessage}` }] });
	}
}

/*
------------------------------------------------------
Process Chat Message (from Webview)
-------------------------------------------------------
*/
export async function askAI({
	userPrompt,
	contextInfo,
	sidebarProvider,
}: {
	userPrompt: string;
	contextInfo?: string;
	sidebarProvider: SidebarProvider;
}) {
	if (!sidebarProvider._view) {
		console.error("[Maple-Code] askAI: Sidebar view is not available.");
		vscode.window.showErrorMessage("Cannot process message: Chat view is not ready.");
		return;
	}

	const userMessageParts: Part[] = [];

	if (contextInfo) userMessageParts.push({ text: `Additional context:\n\`\`\`\n${contextInfo}\n\`\`\`\n` });

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
				sidebarProvider._view.webview.postMessage({
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
