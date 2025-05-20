import * as vscode from "vscode";
import { SidebarProvider } from "./sidebarProvider";
import { loadSettings } from "./dataLoader";
import { initializeAiModel } from "./ai";

export async function activate(context: vscode.ExtensionContext) {
	console.log('[Maple-Code] Congratulations, your extension "maple-code" is now active!');

	//-------------------------------------------------------
	// Load Settings and Initialize AI API
	//-------------------------------------------------------
	const settings = await loadSettings();

	if (settings?.API_KEY) {
		await initializeAiModel(settings.API_KEY);
	} else if (settings === undefined) {
	} else {
		if (Object.keys(settings).length > 0 && !settings.API_KEY) {
			vscode.window.showWarningMessage(
				"AI API key (API_KEY) not found in maple/settings.json at the configured path. AI features will be limited."
			);
		}
	}

	//-------------------------------------------------------
	// Register Sidebar View
	//-------------------------------------------------------
	const sidebarProvider = new SidebarProvider(context.extensionUri);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider("maple-code-chat-view", sidebarProvider));
	console.log("[Maple-Code] Sidebar Provider registered.");

	//-------------------------------------------------------
	// Commands Registration
	//-------------------------------------------------------
	const helloWorldDisposable = vscode.commands.registerCommand("maple-code.helloWorld", () => {
		vscode.window.showInformationMessage("Hello World from Maple-Code!");
	});
	context.subscriptions.push(helloWorldDisposable);

	// registerAiCommands(context, aiModel, sidebarProvider);

	//-------------------------------------------------------
	// Register Commands
	//-------------------------------------------------------
	let loadSettingsCommand = vscode.commands.registerCommand("maple-code.loadSettings", async () => {
		vscode.window.showInformationMessage("Maple Code: Attempting to load settings...");
		const settings = await loadSettings();
		if (settings !== undefined) {
			vscode.window.showInformationMessage("Maple Code: Settings loaded successfully.");
		} else {
			vscode.window.showErrorMessage("Maple Code: Failed to load settings. Check console for details.");
		}
	});

	context.subscriptions.push(loadSettingsCommand);
}

export function deactivate() {}
