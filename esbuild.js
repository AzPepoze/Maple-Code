const esbuild = require("esbuild");
const { sassPlugin } = require("esbuild-sass-plugin"); // Add import

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: "esbuild-problem-matcher",

	setup(build) {
		build.onStart(() => {
			console.log("[watch] build started");
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log("[watch] build finished");
		});
	},
};

async function main() {
	// Build extension
	const extensionCtx = await esbuild.context({
		entryPoints: ["src/extension.ts"],
		bundle: true,
		format: "cjs",
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: "node",
		outfile: "dist/extension.js",
		external: ["vscode"],
		logLevel: "silent",
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	// Build webview
	const webviewCtx = await esbuild.context({
		entryPoints: ["src/UI/main.ts"],
		bundle: true,
		format: "iife", // หรือ 'esm' ถ้าต้องการ module
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: "browser",
		outfile: "media/main.js", // Output ไปที่ media
		logLevel: "silent",
		external: ["vscode"],
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	//-------------------------------------------------------
	// Build SCSS
	//-------------------------------------------------------
	const scssCtx = await esbuild.context({
		entryPoints: ["src/styles.scss"],
		bundle: false, // ไม่ต้อง bundle CSS ส่วนใหญ่
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		outdir: "media", // Output Directory for CSS
		logLevel: "silent",
		plugins: [
			sassPlugin(),
		],
	});


	if (watch) {
		await extensionCtx.watch();
		await webviewCtx.watch();
		await scssCtx.watch(); // Add scssCtx.watch()
	} else {
		await extensionCtx.rebuild();
		await webviewCtx.rebuild();
		await scssCtx.rebuild(); // Add scssCtx.rebuild()
		await extensionCtx.dispose();
		await webviewCtx.dispose();
		await scssCtx.dispose(); // Add scssCtx.dispose()
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
