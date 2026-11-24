/* =========================================================
   单文件打包脚本
   - 将两套主题样式（styles.css / theme-ios.css）以内联 <style> 写入，
     并附主题引导脚本（按 html[data-theme] 启用对应主题）
   - 将 words.js 与全部 JS 内联，生成可直接拷到手机打开的 standalone.html
   注意：所有 replace 必须使用函数替换器，避免内容中的 $&、$' 等
   替换模式被解析（此前 standalone 损坏的根因）。
   运行：node build-standalone.mjs
   ========================================================= */
import { readFileSync, writeFileSync } from "node:fs";

const SCRIPTS = ["words.js", "data.js", "srs.js", "store.js", "ai.js", "app.js"];

let html = readFileSync("index.html", "utf8");

// 1. 内联两套主题样式，替换对应 <link>（函数替换器，避免 $ 模式解析）
html = html.replace(
  /[ \t]*<link[^>]*id="theme-green"[^>]*>\s*/i,
  () => "  <style id=\"theme-green\">\n" + readFileSync("styles.css", "utf8") + "  </style>\n"
);
html = html.replace(
  /[ \t]*<link[^>]*id="theme-ios"[^>]*>\s*/i,
  () => "  <style id=\"theme-ios\">\n" + readFileSync("theme-ios.css", "utf8") + "  </style>\n"
);

// 2. 内联脚本（保持加载顺序）
html = html.replace(
  /[ \t]*<script defer src="words\.js"><\/script>\s*[\s\S]*?<script defer src="app\.js"><\/script>/i,
  () => SCRIPTS.map(name => "  <script>\n" + readFileSync(name, "utf8") + "  </script>").join("\n")
);

// 3. 校验：内联后的每段脚本必须语法完整（防止 $& 类损坏再次发生）
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (blocks.length !== SCRIPTS.length + 1) {
  throw new Error(`脚本块数量异常：期望 ${SCRIPTS.length + 1}，实际 ${blocks.length}`);
}
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const { execFileSync } = await import("node:child_process");
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const tmp = mkdtempSync(join(tmpdir(), "vocab-standalone-"));
blocks.forEach((code, i) => {
  const file = join(tmp, `blk${i}.js`);
  writeFileSync(file, code);
  try {
    execFileSync(process.execPath, ["--check", file]);
  } catch (error) {
    throw new Error(`第 ${i + 1} 段内联脚本语法损坏：${error.stderr}`);
  }
});

writeFileSync("standalone.html", html);
console.log("standalone.html 已生成，大小：", (html.length / 1024).toFixed(1), "KB，脚本块校验通过");
