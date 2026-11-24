/* =========================================================
   词库规范化模块（v3 · 双线训练模型）
   - 完整四六级词库来自 words.js（window.VocabDict，自动生成）
   - 为每条内置词生成稳定 ID（b_单词），保证学习进度跨版本可迁移
   - 多语境材料：每词最多 3 条语境例句（输入线"语境偶遇"的数据基础）
   - 双线字段：exposures（语境接触次数）/ seenContexts（已见语境索引）
     unlocked（是否解锁主动线）/ prodFails（产出失败回炉次数）
   - 提供同义词索引：findByWord 支持点击同义词跳转详情
   ========================================================= */
(function () {
  "use strict";

  const DICT = (typeof window !== "undefined" && window.VocabDict && Array.isArray(window.VocabDict.WORDS))
    ? window.VocabDict.WORDS
    : (console.warn("words.js 未加载，词库为空"), []);

  const DIFFICULTIES = ["简单", "中等", "困难"];
  // v3：只有两条线 —— passive（输入线）与 active（产出线）
  const LEVELS = ["passive", "active"];

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "w_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  /** 解析词典 contexts 编码：每条 "句子\u0001译文"，条目间 \u0002 */
  function parseContexts(raw, fallbackExample, fallbackCn) {
    const list = [];
    const seen = new Set();
    const push = (text, cn) => {
      text = String(text || "").replace(/<[^>]+>/g, "").trim();
      if (!text || text.length < 8) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ text: text, cn: String(cn || "").trim() });
    };
    if (raw) {
      for (const part of String(raw).split("\u0002")) {
        if (!part) continue;
        const [text, cn] = part.split("\u0001");
        push(text, cn);
        if (list.length >= 3) break;
      }
    }
    // 兜底：至少把主例句作为一个语境
    if (list.length === 0) push(fallbackExample, fallbackCn);
    return list;
  }

  /** 将词典行或导入项规范化为统一词汇结构。 */
  function normalizeWord(input, isBuiltin) {
    const item = Array.isArray(input) ? {
      word: input[0], phonetic: input[1], pos: input[2], meaning: input[3],
      collocations: String(input[4] || "").split(/[;；|]/), example: input[5], exampleCn: input[6],
      difficulty: input[7], exam: input[8], synonyms: String(input[9] || ""), contextsRaw: input[10]
    } : Object.assign({}, input);

    const now = new Date().toISOString();
    const collocations = Array.isArray(item.collocations)
      ? item.collocations
      : String(item.collocations || "").split(/[;；|\n]/);
    const synonyms = Array.isArray(item.synonyms)
      ? item.synonyms
      : String(item.synonyms || "").split(/[;；|,，\n]/);
    const contexts = Array.isArray(item.contexts)
      ? item.contexts.map(c => ({ text: String(c.text || "").trim(), cn: String(c.cn || "").trim() })).filter(c => c.text)
      : parseContexts(item.contextsRaw, item.example, item.exampleCn);
    const first = contexts[0] || { text: "", cn: "" };

    // candidate（旧版三线模型）迁移：candidate 视为已具备一定识别基础 → 归入 active
    let level = "passive";
    if (LEVELS.includes(item.level)) level = item.level;
    else if (item.level === "candidate") level = "active";

    return {
      id: item.id || (isBuiltin ? "b_" + String(item.word || "").trim().toLowerCase() : uid()),
      word: String(item.word || "").trim(),
      phonetic: String(item.phonetic || "").trim(),
      pos: String(item.pos || "").trim(),
      meaning: String(item.meaning || item.definition || "").trim(),
      level: level,
      collocations: collocations.map(v => String(v).trim()).filter(Boolean),
      synonyms: synonyms.map(v => String(v).trim().toLowerCase()).filter(Boolean),
      example: first.text,
      exampleCn: first.cn,
      contexts: contexts,
      note: String(item.note || "").trim(),
      difficulty: DIFFICULTIES.includes(item.difficulty) ? item.difficulty : "中等",
      exam: String(item.exam || (isBuiltin ? "CET4" : "custom")).trim(),
      lastReviewedAt: item.lastReviewedAt || null,
      // 内置词使用固定历史时间（即可复习状态），保证进度快照比对稳定、可持久化去重
      nextReviewAt: item.nextReviewAt || (isBuiltin ? "1970-01-01T00:00:00.000Z" : now),
      mastery: Number.isFinite(Number(item.mastery)) ? Math.max(0, Math.min(100, Number(item.mastery))) : 0,
      wrong: Boolean(item.wrong),
      wrongCount: Number(item.wrongCount) || 0,
      correctCount: Number(item.correctCount) || 0,
      consecutiveWrong: Number(item.consecutiveWrong) || 0,
      streak: Number(item.streak) || 0,
      lapseCount: Number(item.lapseCount) || 0,
      // ===== 双线训练字段 =====
      exposures: Number(item.exposures) || 0,            // 输入线：多语境接触次数
      seenContexts: Array.isArray(item.seenContexts)     // 已接触过的语境索引
        ? item.seenContexts.filter(i => Number.isInteger(i))
        : [],
      unlocked: Boolean(item.unlocked) || level === "active", // 是否解锁主动线
      prodFails: Number(item.prodFails) || 0,            // 产出失败（回炉）次数
      conversionStep: Number(item.conversionStep) || 0,  // 主动线阶梯进度 1-4
      isBuiltin: Boolean(isBuiltin || item.isBuiltin),
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now
    };
  }

  function createBuiltins() {
    return DICT.map(item => normalizeWord({
      word: item[0], phonetic: item[1], pos: item[2], meaning: item[3],
      collocations: String(item[4] || ""), example: item[5], exampleCn: item[6],
      difficulty: item[7], exam: item[8],
      synonyms: String(item[9] || ""),
      contextsRaw: item[10]
    }, true));
  }

  /** 同义词跳转：按单词文本在给定词表（默认内置词库）中查找。 */
  function findByWord(word, allWords) {
    const key = String(word || "").trim().toLowerCase();
    if (!key) return null;
    const pool = Array.isArray(allWords) ? allWords : createBuiltins();
    return pool.find(item => item.word.toLowerCase() === key) || null;
  }

  window.VocabData = {
    createBuiltins,
    normalizeWord,
    uid,
    findByWord,
    parseContexts,
    DIFFICULTIES,
    LEVELS,
    IMPORT_TEMPLATE: "word | /wɜːd/ | n. | 单词；话语 | word choice;in other words | She explained the idea in other words. | 换句话说，她解释了这个观点。 | 中等 | custom"
  };
})();
