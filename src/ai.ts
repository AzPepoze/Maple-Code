import * as vscode from "vscode";
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, GenerativeModel } from "@google/generative-ai";
import { SidebarProvider } from "./sidebarProvider";

//-------------------------------------------------------
// AI API Initialization
//-------------------------------------------------------
export async function initializeAiModel(apiKey: string): Promise<GenerativeModel | undefined> {
	if (!apiKey) {
		vscode.window.showErrorMessage("AI API key is missing.");
		return undefined;
	}

	try {
		const genAI = new GoogleGenerativeAI(apiKey);
		const aiModel = genAI.getGenerativeModel({
			model: "gemini-1.5-flash-latest",
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
		});
		return aiModel;
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to initialize AI API: ${error.message}`);
		return undefined;
	}
}

//-------------------------------------------------------
// AI Commands Registration
//-------------------------------------------------------
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
				type: "addMessage",
				value: "Error: AI model is not available. Cannot suggest code.",
				sender: "bot",
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
			await new Promise((resolve) => setTimeout(resolve, 500));
			if (!sidebarProvider._view) {
				vscode.window.showErrorMessage("Maple Code chat view is not available. Please open it first.");
				return;
			}
		}

		sidebarProvider._view?.webview.postMessage({
			type: "addMessage",
			value: `You asked for suggestions for:\n\`\`\`\n${selectedText}\n\`\`\``,
			sender: "user",
		});

		sidebarProvider._view?.webview.postMessage({
			type: "addMessage",
			value: "Maple is thinking...",
			sender: "bot",
			isLoading: true,
		});

		try {
			const prompt = `Complete or suggest an alternative for the following code snippet. If it's a question or instruction, try to answer or generate code based on it:\n\n${selectedText}`;
			const chat = aiModel.startChat();
			const result = await chat.sendMessageStream(prompt);

			sidebarProvider._view?.webview.postMessage({ type: "clearLastBotMessage" });

			let isFirstChunk = true;
			let accumulatedResponse = "";

			for await (const chunk of result.stream) {
				const chunkText = chunk.text();
				accumulatedResponse += chunkText;

				if (isFirstChunk) {
					sidebarProvider._view?.webview.postMessage({
						type: "startBotStream",
						initialChunk: chunkText,
					});
					isFirstChunk = false;
				} else {
					sidebarProvider._view?.webview.postMessage({ type: "appendBotStream", chunk: chunkText });
				}
			}

			sidebarProvider._view?.webview.postMessage({ type: "endBotStream", fullResponse: accumulatedResponse });
		} catch (error: any) {
			const errorMessageContent = `Error suggesting code: ${error.message}`;
			console.error(`[Maple-Code] ${errorMessageContent}`);
			vscode.window.showErrorMessage(errorMessageContent);
			sidebarProvider._view?.webview.postMessage({ type: "clearLastBotMessage" });
			sidebarProvider._view?.webview.postMessage({
				type: "addMessage",
				value: `Error: ${errorMessageContent}`,
				sender: "bot",
			});
		}
	});
	context.subscriptions.push(suggestCodeDisposable);
}
