/* =========================================================
   词库生成脚本（开发期工具，不随应用分发）
   数据源：kajweb/dict（网易有道背单词导出，NDJSON）
   输出：words.js → window.VocabDict.WORDS
   字段：[单词, 音标, 词性, 释义, 搭配(|分隔), 例句, 例句译文, 难度, 分类, 同近义词(|分隔)]
   运行：node tools/build-dict.mjs <ndjson目录> <输出路径>
   ========================================================= */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const srcDir = process.argv[2] || "/tmp/vocab-src/raw";
const outPath = process.argv[3] || "words.js";

const files = readdirSync(srcDir).filter(name => /^CET[46]_\d\.json$/.test(name));
const seen = new Map();          // word(lower) -> entry
const examSets = { CET4: new Set(), CET6: new Set() };
let rawCount = 0;

for (const file of files) {
  const exam = file.startsWith("CET4") ? "CET4" : "CET6";
  const lines = readFileSync(`${srcDir}/${file}`, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    rawCount += 1;
    const word = String(item.headWord || "").trim();
    const c = item.content && item.content.word && item.content.word.content || {};
    if (!word || !Array.isArray(c.trans) || !c.trans.length) continue;
    examSets[exam].add(word.toLowerCase());

    // 音标：英式优先
    const phone = String(c.ukphone || c.usphone || c.phone || "").trim();
    const phonetic = phone ? (phone.startsWith("/") ? phone : `/${phone}/`) : "";

    // 词性 + 释义（字段名：pos）
    const posList = [...new Set(c.trans.map(t => String(t.pos || "").trim().replace(/\.$/, "")).filter(Boolean))];
    const pos = posList.map(p => p + ".").join("/");
    const meaning = c.trans.map(t => String(t.tranCn || "").trim()).filter(Boolean).join("；");
    if (!meaning) continue;

    // 常见搭配（去重，最多 3 组）
    const phrases = (c.phrase && Array.isArray(c.phrase.phrases) ? c.phrase.phrases : [])
      .map(p => String(p.pContent || "").trim())
      .filter(Boolean);
    const coll = [...new Set(phrases)].slice(0, 3).join("|");

    // 多语境材料：普通例句（带译文）+ 真题例句，最多 3 条
    // 编码：每条 "句子\u0001译文"，条目间 \u0002
    const contexts = [];
    const sentList = (c.sentence && Array.isArray(c.sentence.sentences) ? c.sentence.sentences : [])
      .map(s => ({ text: String(s.sContent || "").replace(/<[^>]+>/g, "").trim(), cn: String(s.sCn || "").trim() }))
      .filter(s => s.text);
    const realList = (c.realExamSentence && Array.isArray(c.realExamSentence.sentences) ? c.realExamSentence.sentences : [])
      .map(s => ({ text: String(s.sContent || "").replace(/\.\.\./g, "").replace(/<[^>]+>/g, "").trim(), cn: "" }))
      .filter(s => s.text && s.text.length > 12);
    for (const s of [...sentList, ...realList]) {
      if (contexts.length >= 3) break;
      if (!contexts.some(x => x.text.toLowerCase() === s.text.toLowerCase())) contexts.push(s);
    }
    const ctxStr = contexts.map(s => s.text + (s.cn ? "\u0001" + s.cn : "")).join("\u0002");

    // 例句字段：保留第一条作为主例句
    let ex = "", exc = "";
    if (contexts[0]) { ex = contexts[0].text; exc = contexts[0].cn; }

    // 同近义词（去自身、去重，最多 6 个）
    const synos = [];
    if (c.syno && Array.isArray(c.syno.synos)) {
      for (const group of c.syno.synos) {
        for (const h of (group.hwds || [])) {
          const w = String(h.w || "").trim().toLowerCase();
          if (w && w !== word.toLowerCase() && !synos.includes(w)) synos.push(w);
        }
      }
    }
    const syn = synos.slice(0, 6).join("|");

    const star = Number(item.content.word.content.star) || 0;
    const key = word.toLowerCase();
    const prev = seen.get(key);
    // 优先保留语境更丰富、带例句、带搭配、带音标的完整条目
    const score = entry => (entry[5] ? 4 : 0) + (entry[4] ? 2 : 0) + (entry[1] ? 1 : 0) + (entry[10] ? 3 : 0);
    const candidate = [word, phonetic, pos, meaning, coll, ex, exc, "", exam, syn, ctxStr];
    if (!prev || score(candidate) > score(prev)) seen.set(key, candidate);
  }
}

// 难度标签：CET4∩CET6 → 简单；CET4 → 中等；CET6 → 困难（star≥2 仍为困难，star=0 的 CET6 降为中等）
for (const entry of seen.values()) {
  const key = entry[0].toLowerCase();
  const in4 = examSets.CET4.has(key);
  const in6 = examSets.CET6.has(key);
  if (in4 && in6) entry[7] = "简单";
  else if (in4) entry[7] = "中等";
  else entry[7] = "困难";
}

// 覆盖率统计
const entries = [...seen.values()];
const stat = pred => entries.filter(pred).length;
console.log("原始行数:", rawCount);
console.log("去重后词条:", entries.length);
console.log("CET4 独有:", stat(x => examSets.CET4.has(x[0].toLowerCase()) && !examSets.CET6.has(x[0].toLowerCase())));
console.log("CET6 独有:", stat(x => examSets.CET6.has(x[0].toLowerCase()) && !examSets.CET4.has(x[0].toLowerCase())));
console.log("两者皆有:", stat(x => examSets.CET4.has(x[0].toLowerCase()) && examSets.CET6.has(x[0].toLowerCase())));
console.log("含音标:", stat(x => x[1]), "含搭配:", stat(x => x[4]), "含例句:", stat(x => x[5]), "例句含译文:", stat(x => x[6]), "含同近义词:", stat(x => x[9]));
console.log("难度分布:", JSON.stringify(entries.reduce((m, x) => (m[x[7]] = (m[x[7]] || 0) + 1, m), {})));

// 序列化：紧凑数组，控制体积
const json = JSON.stringify(entries);
const banner = `/* =========================================================
   内置完整四六级词库（自动生成，请勿手改）
   来源：kajweb/dict（有道背单词数据），node tools/build-dict.mjs 生成。
   每条：[单词, 音标, 词性, 释义, 搭配(|), 例句, 例句译文, 难度, 分类, 同近义词(|)]
   ========================================================= */
`;
writeFileSync(outPath, banner + `window.VocabDict = { WORDS: ${json} };\n`);
console.log("输出:", outPath, (json.length / 1024 / 1024).toFixed(2) + "MB");
