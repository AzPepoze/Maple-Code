import * as vscode from "vscode";
import { GenerativeModel } from "@google/generative-ai";

export class SidebarProvider implements vscode.WebviewViewProvider {

	//-------------------------------------------------------
	// Static Properties
	//-------------------------------------------------------
	public static readonly viewType = "maple-code-chat-view";

	//-------------------------------------------------------
	// Class Properties
	//-------------------------------------------------------
	public _view?: vscode.WebviewView;
	private _extensionUri: vscode.Uri;
	private _aiModel?: GenerativeModel;
	private _currentChatContext: {
		fileName: string;
		fileContent: string;
		languageId: string;
		cursorPosition: vscode.Position;
	} | null = null;

	//-------------------------------------------------------
	// Constructor
	//-------------------------------------------------------
	constructor(extensionUri: vscode.Uri, aiModel?: GenerativeModel) {
		this._extensionUri = extensionUri;
		this._aiModel = aiModel;
	}

	//-------------------------------------------------------
	// Public Methods
	//-------------------------------------------------------
	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		console.log("[Maple-Code] resolveWebviewView called.");
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, "media"),
			],
		};

		this._getHtmlForWebview(webviewView.webview)
			.then((html) => {
				webviewView.webview.html = html;
			})
			.catch((err) => {
				console.error("[Maple-Code] Failed to load webview HTML:", err);
				webviewView.webview.html = `<h1>Error loading webview</h1><p>${err.message}</p>`;
			});

		// --- Handle Messages ---
		webviewView.webview.onDidReceiveMessage(async (message: any) => {
			if (!this._view) return;

			console.log(message);

			switch (message.type) {
				case "message": // User sent a message from input
					if (!this._aiModel) {
						this._postMessageSafe({
							type: "addMessage",
							value: "Error: AI model not available. Please ensure you have a workspace folder open and your API key is set in maple/settings.json.",
							sender: "bot",
						});
						return;
					}

					let userPrompt = message.value;
					let contextInfo: {
						fileName: string;
						fileContent: string;
						languageId: string;
						cursorPosition: vscode.Position;
					} | null = null;

					if (message.includeContext) {
						contextInfo = this._getCurrentFileContext();
						if (!contextInfo) {
							this._postMessageSafe({
								type: "addMessage",
								value: "Info: Could not get context from active editor.",
								sender: "bot",
							});
						}
					}

					// Construct the final prompt
					let fullPrompt = userPrompt;
					if (contextInfo) {
						const contextPrefix = `Relevant code context from ${contextInfo.fileName} (${
							contextInfo.languageId
						}):\n\`\`\`${contextInfo.languageId}\n${contextInfo.fileContent.substring(
							0,
							2000
						)}...\n\`\`\`\n\nUser query:`;
						fullPrompt = `${contextPrefix} ${userPrompt}`;
					}

					// --- Start Streaming ---
					this._postMessageSafe({
						type: "addMessage",
						value: "Maple is thinking...",
						sender: "bot",
						isLoading: true,
					});

					try {
						const chat = this._aiModel.startChat();
						const result = await chat.sendMessageStream(fullPrompt);

						let isFirstChunk = true;
						let accumulatedResponse = "";

						for await (const chunk of result.stream) {
							const chunkText = chunk.text();
							accumulatedResponse += chunkText;

							if (isFirstChunk) {
								this._postMessageSafe({ type: "startBotStream", initialChunk: chunkText });
								isFirstChunk = false;
							} else {
								this._postMessageSafe({ type: "appendBotStream", chunk: chunkText });
							}
						}

						this._postMessageSafe({ type: "endBotStream", fullResponse: accumulatedResponse });
					} catch (error: any) {
						const errorMessageContent = `Error communicating with AI API: ${error.message}`;
						console.error(`[Maple-Code] ${errorMessageContent}`);
						vscode.window.showErrorMessage(errorMessageContent);
						this._postMessageSafe({ type: "clearLastBotMessage" });
						this._postMessageSafe({
							type: "addMessage",
							value: `Error: ${errorMessageContent}`,
							sender: "bot",
						});
					}
					break;

				case "getDiagnostics":
					const diagnostics = vscode.languages.getDiagnostics();
					const simplifiedDiagnostics = diagnostics.map((diagnosticEntry) => ({
						uri: diagnosticEntry[0].toString(),
						diagnostics: diagnosticEntry[1].map((d) => ({
							range: {
								start: { line: d.range.start.line, character: d.range.start.character },
								end: { line: d.range.end.line, character: d.range.end.character },
							},
							message: d.message,
							severity: vscode.DiagnosticSeverity[d.severity],
							code: d.code ? (d.code as any).value || d.code : undefined,
							source: d.source,
						})),
					}));
					this._postMessageSafe({ type: "diagnostics", value: simplifiedDiagnostics });
					break;
				default:
					console.warn("[Maple-Code] SidebarProvider: Received unknown message type: ", message.type);
			}
		});

		// Inform webview if API key is missing after setup
		if (!this._aiModel) {
			const errorMessage =
				"AI API key not found or failed to initialize. Please ensure you have a workspace folder open and your API key is set in maple/settings.json.";
			this._postMessageSafe({ type: "addMessage", value: `Error: ${errorMessage}`, sender: "bot" });
		}
	}

	//-------------------------------------------------------
	// Private Helper Methods
	//-------------------------------------------------------
	private _postMessageSafe(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		} else {
			console.warn("[Maple-Code] Attempted to post message, but webview view is not available.", message);
		}
	}

	private _getCurrentFileContext(): {
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
				fileName: document.fileName.split(/[\\/]/).pop() || document.fileName,
				fileContent: contextText,
				languageId: document.languageId,
				cursorPosition: position,
			};
		}
		return null;
	}

	private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
		const htmlPath = vscode.Uri.joinPath(this._extensionUri, "media", "webview.html");
		const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
		let html = Buffer.from(htmlContent).toString("utf8");

		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "main.js"));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "styles.css"));
		const nonce = getNonce();
		const cspSource = webview.cspSource;

		html = html.replace(/{{scriptUri}}/g, scriptUri.toString());
		html = html.replace(/{{styleUri}}/g, styleUri.toString());
		html = html.replace(/{{nonce}}/g, nonce);
		html = html.replace(/{{cspSource}}/g, cspSource);

		return html;
	}
}

function getNonce() {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
