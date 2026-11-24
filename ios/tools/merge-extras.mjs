// 合并手工补充词 + misled 修正 → words.js（一次性脚本）
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../words.js", import.meta.url), "utf8");
const extras = JSON.parse(readFileSync(new URL("./extras.json", import.meta.url), "utf8"));

const m = src.match(/window\.VocabDict = \{ WORDS: (\[[\s\S]*\]) \};?/);
if (!m) throw new Error("words.js 格式不匹配");
const words = eval(m[1]);

const names = new Set(words.map(w => w[0]));
let added = 0;
for (const e of extras) {
  if (!names.has(e[0])) { words.push(e); added++; }
}

const misled = words.find(w => w[0] === "misled");
if (misled) {
  if (!misled[2]) misled[2] = "v.";
  misled[1] = (misled[1] || "").replace(/^,/, "/");
  if (!misled[10]) misled[10] = misled[5] ? misled[5] + "\u0001" + (misled[6] || "") : "";
}

words.sort((a, b) => a[0].localeCompare(b[0]));

const out = "// 词流 Lexicon Flow 内置词库（自动生成，请勿手工编辑）\n" +
  "// 行格式: [word, phonetic, pos, meaning, collocations(|), example, exampleCn, difficulty, exam, synonyms(|), contexts]\n" +
  "// contexts 编码: 每条 \"句子\\u0001译文\"，条目间 \\u0002\n" +
  "window.VocabDict = { WORDS: " + JSON.stringify(words) + " };\n";
writeFileSync(new URL("../words.js", import.meta.url), out, "utf8");
console.log("merged extras:", added, "total:", words.length);

let withCtx = 0, multiCtx = 0, ctxCount = 0;
for (const w of words) {
  const c = w[10] ? w[10].split("\u0002").filter(Boolean) : [];
  if (c.length) withCtx++;
  if (c.length >= 2) multiCtx++;
  ctxCount += c.length;
}
console.log("含语境词数:", withCtx, "/", words.length, " 多语境(>=2):", multiCtx, " 总语境条数:", ctxCount);
