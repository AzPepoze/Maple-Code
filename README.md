## Configuration

To use this extension, you need to set your Gemini API key in a `settings.json` file within a folder you specify in VS Code settings.

1. Create a folder (e.g., `maple` in your home directory or workspace).
2. Inside that folder, create a file named `settings.json`.
3. Add your API key to `settings.json` like this:
     ```json
     {
     	"API_KEY": "YOUR_GEMINI_API_KEY"
     }
     ```
4. Open VS Code settings (`File > Preferences > Settings` or `Code > Settings > Settings`).
5. Search for `mapleCode.settingsFolderPath`.
6. Enter the **absolute path** to the folder you created in step 1 (e.g., `/Users/yourusername/maple` or `C:\Users\yourusername\maple`).

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

-    `mapleCode.settingsFolderPath`: Specifies the absolute path to the folder containing `settings.json` with your API key.
