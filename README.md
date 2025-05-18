# maple-code README

This is the README for your extension "maple-code". After writing up a brief description, we recommend including the following sections.

## Features

-    **AI Chat Sidebar:** Interact with the AI model directly within a dedicated sidebar view.
-    **Context Inclusion:** Optionally include code context from your active editor in your chat prompts.
-    **Real-time Streaming:** See AI responses appear in real-time as they are generated.
-    **Code Suggestion from Editor:** Select code in your editor and use the "Maple Code: Suggest Code from Editor" command to get AI suggestions or explanations directly in the chat.
-    **Project Diagnostics:** Get a summary of project diagnostics (errors, warnings, etc.) in the chat.

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Configuration

To use this extension, you need to set your Gemini API key in a `settings.json` file within a folder you specify in VS Code settings.

1.   Create a folder (e.g., `maple` in your home directory or workspace).
2.   Inside that folder, create a file named `settings.json`.
3.   Add your API key to `settings.json` like this:
     ```json
     {
     	"API_KEY": "YOUR_GEMINI_API_KEY"
     }
     ```
4.   Open VS Code settings (`File > Preferences > Settings` or `Code > Settings > Settings`).
5.   Search for `mapleCode.settingsFolderPath`.
6.   Enter the **absolute path** to the folder you created in step 1 (e.g., `/Users/yourusername/maple` or `C:\Users\yourusername\maple`).

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

-    `mapleCode.settingsFolderPath`: Specifies the absolute path to the folder containing `settings.json` with your API key.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

-    [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

-    Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
-    Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
-    Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

-    [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
-    [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
