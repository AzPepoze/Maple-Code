import * as vscode from "vscode";
import {
	GoogleGenerativeAI,
	HarmBlockThreshold,
	HarmCategory,
	GenerativeModel,
	Part,
	Content,
	FunctionCall,
	GenerateContentRequest,
	FunctionDeclarationSchemaType,
} from "@google/generative-ai";
import { SidebarProvider } from "./sidebarProvider";
import { loadInstructionFile } from "./dataLoader";

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
const SYSTEM_ROLE_NAME = "system";
const MODEL_ROLE_NAME = "model";

/*
------------------------------------------------------
Global State
-------------------------------------------------------
*/
const chatHistory: Content[] = [];

/*
------------------------------------------------------
AI API Initialization
-------------------------------------------------------
*/
export async function initializeAiModel(apiKey: string): Promise<GenerativeModel | undefined> {
	if (!apiKey) {
		vscode.window.showErrorMessage("AI API key is missing.");
		return undefined;
	}

	try {
		const genAI = new GoogleGenerativeAI(apiKey);
		const aiModel = genAI.getGenerativeModel({
			model: "gemini-2.0-flash", // Consider making model name configurable
			safetySettings: [
				{
					category: HarmCategory.HARM_CATEGORY_HARASSMENT,
					threshold: HarmBlockThreshold.BLOCK_NONE,
				},
				{
					category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
					threshold: HarmBlockThreshold.BLOCK_NONE,
				},
				{
					category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
					threshold: HarmBlockThreshold.BLOCK_NONE,
				},
				{
					category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
					threshold: HarmBlockThreshold.BLOCK_NONE,
				},
			],
			tools: [
				{
					functionDeclarations: [
						{
							name: "exampleTool",
							description: "An example tool to demonstrate function calling.",
							parameters: {
								type: FunctionDeclarationSchemaType.OBJECT,
								properties: {
									param1: {
										type: FunctionDeclarationSchemaType.STRING,
										description: "A sample parameter.",
									},
								},
								required: ["param1"],
							},
						},
						// Add more function declarations as needed
					],
				},
			],
		});
		return aiModel;
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to initialize AI API: ${error.message}`);
		return undefined;
	}
}

/*
------------------------------------------------------
Private Helper: AI Interaction Handler
-------------------------------------------------------
*/
async function _handleGenerativeAiRequest(
	aiModel: GenerativeModel,
	currentQueryForSystemContext: string,
	sidebarProvider: SidebarProvider
	// chatHistory is accessed globally
) {
	if (!sidebarProvider._view) {
		console.error("[Maple-Code] _handleGenerativeAiRequest: Sidebar view is not available.");
		vscode.window.showErrorMessage("Maple Code chat view is not available. Please open it first.");
		return;
	}

	sidebarProvider._view.webview.postMessage({
		type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
		value: "Requesting API...",
		sender: BOT_SENDER_NAME,
		isLoading: true,
	});

	try {
		const instructionContent = await loadInstructionFile("Instruction.md");
		const systemInstructionParts: Part[] = [];

		if (instructionContent) {
			systemInstructionParts.push({ text: `Instructions:\n${instructionContent}` });
		}
		systemInstructionParts.push({ text: `\nUser query (for system context): ${currentQueryForSystemContext}` });

		const generateContentRequest: GenerateContentRequest = {
			contents: chatHistory, // Pass the full chat history
			systemInstruction: {
				role: SYSTEM_ROLE_NAME,
				parts: systemInstructionParts,
			},
		};

		sidebarProvider._view.webview.postMessage({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: JSON.stringify(chatHistory, null, 2),
			sender: USER_SENDER_NAME,
		});

		const result = await aiModel.generateContentStream(generateContentRequest);

		sidebarProvider._view.webview.postMessage({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });

		let isFirstChunk = true;
		let fullResponse = "";
		let functionCallEncountered: FunctionCall | undefined = undefined;

		for await (const chunk of result.stream) {
			if (chunk.candidates && chunk.candidates[0].content) {
				const content = chunk.candidates[0].content;

				if (content.parts) {
					for (const part of content.parts) {
						if (part.text) {
							const chunkText = part.text;
							fullResponse += chunkText;

							if (isFirstChunk) {
								sidebarProvider._view.webview.postMessage({
									type: WEBVIEW_MESSAGE_TYPES.START_BOT_STREAM,
									initialChunk: chunkText,
								});
								isFirstChunk = false;
							} else {
								sidebarProvider._view.webview.postMessage({
									type: WEBVIEW_MESSAGE_TYPES.APPEND_BOT_STREAM,
									chunk: chunkText,
								});
							}
						}

						if (part.functionCall) {
							functionCallEncountered = part.functionCall;
							console.log("[Maple-Code] Received function call:", functionCallEncountered);
							// TODO: Implement actual function execution.
							// This might involve a dispatcher mapping functionCall.name to a function.
							// e.g., const fnResult = await executeFunction(functionCall.name, functionCall.args);
							// Then, send a new message to the model with the function's response:
							// chatHistory.push({ role: 'function', parts: [{ functionResponse: { name: functionCall.name, response: { content: JSON.stringify(fnResult) } } }] });
							// And potentially make another generateContent call.
							sidebarProvider._view.webview.postMessage({
								type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
								value: `Bot wants to call function: ${
									functionCallEncountered.name
								} with args: ${JSON.stringify(functionCallEncountered.args)}`,
								sender: BOT_SENDER_NAME,
							});
							break; // Stop processing parts in this chunk
						}
					}
				}
			}
			if (functionCallEncountered) break; // Stop processing stream if a function call was detected
		}

		const botResponseContent: Content = {
			role: MODEL_ROLE_NAME,
			parts: [],
		};

		if (fullResponse) {
			botResponseContent.parts.push({ text: fullResponse });
			sidebarProvider._view.webview.postMessage({
				type: WEBVIEW_MESSAGE_TYPES.END_BOT_STREAM,
				fullResponse: fullResponse,
			});
		}

		if (functionCallEncountered) {
			botResponseContent.parts.push({ functionCall: functionCallEncountered });
		}

		if (botResponseContent.parts.length > 0) {
			chatHistory.push(botResponseContent);
		}

		console.log("[Maple-Code] Updated Chat History:", chatHistory);
	} catch (error: any) {
		const errorMessageContent = `Error processing AI request: ${error.message}`;
		console.error(`[Maple-Code] ${errorMessageContent}`);
		vscode.window.showErrorMessage(errorMessageContent);
		sidebarProvider._view.webview.postMessage({ type: WEBVIEW_MESSAGE_TYPES.CLEAR_LAST_BOT_MESSAGE });
		sidebarProvider._view.webview.postMessage({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: `Error: ${errorMessageContent}`,
			sender: BOT_SENDER_NAME,
		});
	}
}

/*
------------------------------------------------------
AI Commands Registration
-------------------------------------------------------
*/
export function registerAiCommands(
	context: vscode.ExtensionContext,
	aiModel: GenerativeModel | undefined,
	sidebarProvider: SidebarProvider
) {
	const suggestCodeDisposable = vscode.commands.registerCommand("maple-code.suggestCodeFromEditor", async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage("No active text editor found.");
			return;
		}

		if (!aiModel) {
			vscode.window.showErrorMessage("AI model is not available. Please check your API key.");
			sidebarProvider._view?.webview.postMessage({
				type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
				value: "Error: AI model is not available. Cannot suggest code.",
				sender: BOT_SENDER_NAME,
			});
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (!selectedText.trim()) {
			vscode.window.showInformationMessage("No text selected to suggest code for.");
			return;
		}

		if (!sidebarProvider._view) {
			await vscode.commands.executeCommand("workbench.view.extension.maple-code-view-container");
			await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for view to potentially open
			if (!sidebarProvider._view) {
				vscode.window.showErrorMessage("Maple Code chat view is not available. Please open it first.");
				return;
			}
		}

		const userContent: Content = { role: USER_SENDER_NAME, parts: [{ text: selectedText }] };
		chatHistory.push(userContent);

		sidebarProvider._view.webview.postMessage({
			type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
			value: `You asked for suggestions for:\n\`\`\`\n${selectedText}\n\`\`\``,
			sender: USER_SENDER_NAME,
		});

		await _handleGenerativeAiRequest(aiModel, selectedText, sidebarProvider);
	});
	context.subscriptions.push(suggestCodeDisposable);
}

/*
------------------------------------------------------
Process Chat Message (from Webview)
-------------------------------------------------------
*/
export async function processChatMessage(
	aiModel: GenerativeModel,
	userPrompt: string,
	sidebarProvider: SidebarProvider
) {
	if (!sidebarProvider._view) {
		console.error("[Maple-Code] processChatMessage: Sidebar view is not available.");
		// Optionally, inform the user through a VS Code message if this state is critical
		vscode.window.showErrorMessage("Cannot process message: Chat view is not ready.");
		return;
	}

	const userContent: Content = { role: USER_SENDER_NAME, parts: [{ text: userPrompt }] };
	chatHistory.push(userContent);

	sidebarProvider._view.webview.postMessage({
		type: WEBVIEW_MESSAGE_TYPES.ADD_MESSAGE,
		value: `You asked for suggestions for:\n\`\`\`\n${userPrompt}\n\`\`\``, // Consistent message format
		sender: USER_SENDER_NAME,
	});

	await _handleGenerativeAiRequest(aiModel, userPrompt, sidebarProvider);
}
