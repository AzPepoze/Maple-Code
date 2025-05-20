import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

async function resolveAbsolutePath(filePath: string): Promise<string | undefined> {
	if (path.isAbsolute(filePath)) {
		return filePath;
	}

	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		const currentFileDir = path.dirname(activeEditor.document.uri.fsPath);
		return path.join(currentFileDir, filePath);
	}

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && workspaceFolders.length > 0) {
		return path.join(workspaceFolders[0].uri.fsPath, filePath);
	}

	return undefined;
}

export const toolFunctions = {
	read_file: async ({ filePath }: { filePath: string }) => {
		try {
			const absolutePath = await resolveAbsolutePath(filePath);

			if (!absolutePath) {
				return `Error: Cannot determine absolute path for relative path "${filePath}" without an active editor or workspace. Please provide an absolute path.`;
			}

			const fileExists = await fs
				.stat(absolutePath)
				.then((stats) => stats.isFile())
				.catch(() => false);

			if (!fileExists) {
				return `Error: File not found at ${absolutePath}`;
			}

			const content = await fs.readFile(absolutePath, "utf-8");
			return content;
		} catch (error: any) {
			return `Error reading file '${filePath}': ${error.message}`;
		}
	},
	write_file: async ({ filePath, content }: { filePath: string; content: string }) => {
		console.log(content);
		try {
			const absolutePath = await resolveAbsolutePath(filePath);

			if (!absolutePath) {
				return `Error: Cannot determine absolute path for relative path "${filePath}" without an active editor or workspace. Please provide an absolute path.`;
			}

			const directoryPath = path.dirname(absolutePath);
			await fs.mkdir(directoryPath, { recursive: true });

			await fs.writeFile(absolutePath, content);
			return `File '${filePath}' written successfully.`;
		} catch (error: any) {
			return `Error writing file '${filePath}': ${error.message}`;
		}
	},
};
