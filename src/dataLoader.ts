import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

interface MapleSettings {
	API_KEY?: string;
}

//-------------------------------------------------------
// Load Settings from File
//-------------------------------------------------------
export async function loadSettings(): Promise<MapleSettings | undefined> {
	const config = vscode.workspace.getConfiguration("maple-code");
	const configuredPath = config.get<string>("settingsFolderPath");

	if (!configuredPath || typeof configuredPath !== "string") {
		console.warn(
			"[Maple-Code] 'maple-code.settingsFolderPath' is not configured or is invalid. Cannot load settings. AI features will be limited."
		);
		return undefined;
	}

	let settingsFolderPath: string;
	try {
		settingsFolderPath = path.resolve(configuredPath);
		const stats = await fs.stat(settingsFolderPath);
		if (!stats.isDirectory()) {
			console.warn(
				`[Maple-Code] Configured settingsFolderPath "${configuredPath}" is not a directory. Cannot load settings. AI features will be limited.`
			);
			return undefined;
		}
	} catch (error: any) {
		console.warn(
			`[Maple-Code] Failed to access configured settingsFolderPath "${configuredPath}". Error: ${error.message}. Cannot load settings. AI features will be limited.`
		);
		return undefined;
	}

	const settingsFilePath = path.join(settingsFolderPath, "settings.json");
	console.log(`[Maple-Code] Attempting to load settings from configured path: ${settingsFilePath}`);

	try {
		const fileContent = await fs.readFile(settingsFilePath, "utf-8");
		const settings = JSON.parse(fileContent) as MapleSettings;
		return settings;
	} catch (error: any) {
		if (error.code === "ENOENT") {
			console.warn(
				`[Maple-Code] settings.json not found at ${settingsFilePath}. AI features will be limited.`
			);
			return {};
		} else if (error instanceof SyntaxError) {
			vscode.window.showErrorMessage(
				`[Maple-Code] Failed to parse settings.json at ${settingsFilePath}. Please check the file format. Error: ${error.message}`
			);
			return undefined;
		} else {
			vscode.window.showErrorMessage(
				`[Maple-Code] Failed to read settings.json at ${settingsFilePath}. Error: ${error.message}`
			);
			return undefined;
		}
	}
}

//-------------------------------------------------------
// Load Instruction File
//-------------------------------------------------------
export async function loadInstructionFile(fileName: string): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration("maple-code");
	const configuredPath = config.get<string>("settingsFolderPath");

	if (!configuredPath || typeof configuredPath !== "string") {
		console.warn(
			"[Maple-Code] 'maple-code.settingsFolderPath' is not configured or is invalid. Cannot load instruction file."
		);
		return undefined;
	}

	let settingsFolderPath: string;
	try {
		settingsFolderPath = path.resolve(configuredPath);
		const stats = await fs.stat(settingsFolderPath);
		if (!stats.isDirectory()) {
			console.warn(
				`[Maple-Code] Configured settingsFolderPath "${configuredPath}" is not a directory. Cannot load instruction file.`
			);
			return undefined;
		}
	} catch (error: any) {
		console.warn(
			`[Maple-Code] Failed to access configured settingsFolderPath "${configuredPath}". Error: ${error.message}. Cannot load instruction file.`
		);
		return undefined;
	}

	const instructionFilePath = path.join(settingsFolderPath, fileName);
	console.log(`[Maple-Code] Attempting to load instruction file from configured path: ${instructionFilePath}`);

	try {
		const fileContent = await fs.readFile(instructionFilePath, "utf-8");
		return fileContent;
	} catch (error: any) {
		if (error.code === "ENOENT") {
			console.warn(
				`[Maple-Code] Instruction file "${fileName}" not found at ${instructionFilePath}.`
			);
			return undefined;
		} else {
			vscode.window.showErrorMessage(
				`[Maple-Code] Failed to read instruction file "${fileName}" at ${instructionFilePath}. Error: ${error.message}`
			);
			return undefined;
		}
	}
}
