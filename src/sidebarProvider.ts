import * as vscode from "vscode";
// Import askAI and getCurrentFileContext from ai.ts
import { askAI } from "./ai";

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

	//-------------------------------------------------------
	// Constructor
	//-------------------------------------------------------
	constructor(extensionUri: vscode.Uri) {
		this._extensionUri = extensionUri;
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
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "media")],
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

			console.log("[Maple-Code] Received message from webview:", message);

			switch (message.type) {
				case "message":
					let userPrompt = message.value;
					// Pass the includeContext flag directly
					let includeContext = message.includeContext;

					// Use the askAI function from ai.ts
					try {
						// Pass the user prompt, includeContext flag, and the sidebar provider instance
						await askAI({
							userPrompt: userPrompt,
							includeContext: includeContext, // Pass the boolean flag
							sidebarProvider: this,
						});
					} catch (error: any) {
						const errorMessageContent = `Error processing chat message: ${error.message}`;
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
	}

	/**
	 * Safely posts a message to the webview.
	 * @param message The message object to post.
	 */
	public _postMessageSafe(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		} else {
			console.warn("[Maple-Code] Attempted to post message, but webview view is not available.", message);
		}
	}

	//-------------------------------------------------------
	// Private Helper Methods
	//-------------------------------------------------------

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
