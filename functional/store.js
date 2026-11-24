/* =========================================================
   本地数据仓库（v3 · 双线训练模型）
   - 内置词库（6667 词）常驻内存，不占用 localStorage
   - localStorage 只保存：学习进度覆盖、个人词汇、日志、设置
   - 自动迁移旧版 v1 数据（按单词文本匹配进度，candidate → active）
   - 双线规则：
     · 输入线（passive）：答对 = 一次有效语境接触（exposures+1）
       稳定识别门槛：exposures>=3 且 streak>=2 且 mastery>=60 → 解锁主动线
     · 产出线（active）：四级阶梯逐级通过；产出失败 → 回炉输入线
       （level=passive、unlocked=false、mastery 减半、prodFails+1）
   ========================================================= */
(function () {
  "use strict";

  const STORAGE_KEY = "lexicon-flow:v2";
  const LEGACY_KEY = "lexicon-flow:v1";
  const Data = window.VocabData;
  const SRS = window.VocabSRS;

  // 内置词允许被本地记录覆盖的字段（学习进度 + 个人备注 + 双线字段）
  const PROGRESS_FIELDS = [
    "level", "mastery", "nextReviewAt", "lastReviewedAt", "streak",
    "wrong", "wrongCount", "correctCount", "consecutiveWrong",
    "lapseCount", "conversionStep", "note", "difficulty", "exam",
    "exposures", "seenContexts", "unlocked", "prodFails"
  ];

  // 稳定识别门槛（输入线 → 主动线）
  const UNLOCK_EXPOSURES = 3;
  const UNLOCK_STREAK = 2;
  const UNLOCK_MASTERY = 60;
  // 主动线阶梯层数
  const LADDER_STEPS = 4;

  let state = null;
  let pristine = null; // id -> 进度字段快照，用于只持久化有变化的内置词

  function snapshotPristine() {
    const map = {};
    Data.createBuiltins().forEach(word => { map[word.id] = canonProgress(word); });
    return map;
  }

  function defaultSettings() {
    return {
      dailyGoal: 20,
      ttsRate: 0.9,
      theme: null,
      ai: { endpoint: "", apiKey: "", model: "gpt-4o-mini" }
    };
  }

  function pickProgress(word) {
    const result = {};
    PROGRESS_FIELDS.forEach(field => { result[field] = word[field] === undefined ? null : word[field]; });
    return result;
  }

  function canonProgress(word) {
    return JSON.stringify(PROGRESS_FIELDS.map(field => (word[field] === undefined ? null : word[field])));
  }

  function computeWords(progress, userWords) {
    const builtins = Data.createBuiltins();
    const merged = builtins.map(builtin => {
      const override = progress[builtin.id];
      if (!override) return builtin;
      const word = Object.assign({}, builtin);
      PROGRESS_FIELDS.forEach(field => {
        if (override[field] !== undefined && override[field] !== null) word[field] = override[field];
      });
      // 兜底：解锁状态与等级保持一致
      if (word.level === "active") word.unlocked = true;
      return word;
    });
    return userWords.map(item => Data.normalizeWord(item, false)).concat(merged);
  }

  function defaultState() {
    const progress = {};
    const userWords = [];
    return {
      version: 2,
      words: computeWords(progress, userWords),
      progress,
      userWords,
      logs: [],
      settings: defaultSettings(),
      createdAt: new Date().toISOString()
    };
  }

  function save() {
    // 只持久化有变化的内置词进度 + 个人词汇，避免 6667 词撑爆 localStorage
    const progress = {};
    const userWords = [];
    state.words.forEach(word => {
      if (word.isBuiltin) {
        if (pristine[word.id] === undefined || canonProgress(word) !== pristine[word.id]) {
          progress[word.id] = pickProgress(word);
        }
      } else {
        userWords.push(word);
      }
    });
    state.progress = progress;
    state.userWords = userWords;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        progress,
        userWords,
        logs: state.logs,
        settings: state.settings,
        createdAt: state.createdAt
      }));
    } catch (error) {
      throw new Error("本地保存失败，请检查浏览器存储空间或隐私模式设置。");
    }
  }

  /** 从旧版 v1 数据迁移：按单词文本把学习进度映射到新的稳定 ID 上。 */
  function migrateLegacy() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.words)) return null;
      const builtins = Data.createBuiltins();
      const byText = new Map(builtins.map(word => [word.word.toLowerCase(), word]));
      const progress = {};
      const userWords = [];
      parsed.words.forEach(item => {
        if (item && item.isBuiltin) {
          const target = byText.get(String(item.word || "").toLowerCase());
          // 注意：这里只提取进度字段，isBuiltin 传 false 以保留原有 level（candidate 会归入 active）
          if (target) progress[target.id] = pickProgress(Data.normalizeWord(item, false));
        } else if (item && String(item.word || "").trim()) {
          userWords.push(Data.normalizeWord(item, false));
        }
      });
      return {
        version: 2,
        progress,
        userWords,
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
        settings: Object.assign(defaultSettings(), parsed.settings || {}),
        createdAt: parsed.createdAt || new Date().toISOString()
      };
    } catch (error) {
      console.warn("旧数据迁移失败，使用全新词库。", error);
      return null;
    }
  }

  function load() {
    if (state) return state;
    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (error) {
      console.warn("本地数据解析失败，尝试旧版迁移。", error);
    }
    if (!stored || stored.version !== 2) stored = migrateLegacy();

    if (stored && typeof stored === "object") {
      state = {
        version: 2,
        words: computeWords(stored.progress || {}, Array.isArray(stored.userWords) ? stored.userWords : []),
        progress: stored.progress || {},
        userWords: Array.isArray(stored.userWords) ? stored.userWords : [],
        logs: Array.isArray(stored.logs) ? stored.logs : [],
        settings: Object.assign(defaultSettings(), stored.settings || {}),
        createdAt: stored.createdAt || new Date().toISOString()
      };
      state.settings.ai = Object.assign({}, defaultSettings().ai, stored.settings && stored.settings.ai || {});
    } else {
      state = defaultState();
      pristine = snapshotPristine();
      save();
    }

    // 记录内置词的初始进度快照
    pristine = snapshotPristine();
    return state;
  }

  function getState() { return load(); }
  function getWord(id) { return load().words.find(word => word.id === id); }

  function findDuplicate(word) {
    const normalized = String(word || "").trim().toLowerCase();
    return load().words.find(item => item.word.toLowerCase() === normalized);
  }

  function addWord(input) {
    if (!String(input.word || "").trim()) throw new Error("请填写单词。 ");
    if (!String(input.meaning || input.definition || "").trim()) throw new Error("请填写核心释义。 ");
    if (findDuplicate(input.word)) throw new Error("这个单词已经在词库中。 ");
    const word = Data.normalizeWord(input, false);
    load().words.unshift(word);
    save();
    return word;
  }

  function updateWord(id, changes) {
    const words = load().words;
    const index = words.findIndex(word => word.id === id);
    if (index < 0) throw new Error("未找到这条词汇。 ");
    const duplicate = findDuplicate(changes.word);
    if (duplicate && duplicate.id !== id) throw new Error("这个单词已经在词库中。 ");
    const updated = Data.normalizeWord(Object.assign({}, words[index], changes, {
      id,
      updatedAt: new Date().toISOString()
    }), false);
    words[index] = updated;
    save();
    return updated;
  }

  function removeWord(id) {
    const words = load().words;
    const index = words.findIndex(word => word.id === id);
    if (index < 0) return;
    words.splice(index, 1);
    save();
  }

  function addLog(entry) {
    const log = Object.assign({
      id: Data.uid(),
      createdAt: new Date().toISOString()
    }, entry);
    state.logs.unshift(log);
    if (state.logs.length > 5000) state.logs.length = 5000;
    return log;
  }

  /**
   * 记录一次答题（v3 双线模型）。
   * @param {string} id 词汇 ID
   * @param {object} options
   *   - correct: 是否正确
   *   - line: "passive"（输入线）| "active"（产出线）
   *   - rating: SRS 评分 0-4（correct 时默认 2）
   *   - contextIndex: 输入线本次接触的语境索引（可选）
   *   - stepPass: 产出线本题是否通过（active 线有效）
   */
  function recordAttempt(id, options) {
    const words = load().words;
    const index = words.findIndex(item => item.id === id);
    if (index < 0) throw new Error("词汇不存在，可能已被删除。 ");
    const original = words[index];
    const correct = Boolean(options.correct);
    const line = options.line === "active" ? "active" : "passive";
    const rating = correct ? Math.max(1, Math.min(4, Number(options.rating) || 2)) : 0;
    const from = original.level;
    const next = SRS.apply(original, rating);
    const events = [];

    next.correctCount = (original.correctCount || 0) + (correct ? 1 : 0);
    next.wrongCount = (original.wrongCount || 0) + (correct ? 0 : 1);
    next.consecutiveWrong = correct ? 0 : (original.consecutiveWrong || 0) + 1;
    next.lapseCount = (original.lapseCount || 0) + (correct ? 0 : 1);
    next.wrong = !correct;

    if (line === "passive") {
      // ===== 输入线：语境接触 + 稳定识别判定 =====
      if (correct) {
        next.exposures = (original.exposures || 0) + 1;
        const ctxIndex = Number(options.contextIndex);
        if (Number.isInteger(ctxIndex)) {
          const seen = Array.isArray(original.seenContexts) ? original.seenContexts.slice() : [];
          if (!seen.includes(ctxIndex)) seen.push(ctxIndex);
          next.seenContexts = seen;
        }
        const meetsExposure = next.exposures >= UNLOCK_EXPOSURES;
        const meetsStreak = next.streak >= UNLOCK_STREAK;
        const meetsMastery = next.mastery >= UNLOCK_MASTERY;
        if (!next.unlocked && meetsExposure && meetsStreak && meetsMastery) {
          next.unlocked = true;
          next.level = "active";
          next.conversionStep = 0;
          next.nextReviewAt = new Date().toISOString();
          events.push({ type: "unlocked", text: "识别稳定，主动线已解锁（进入阶梯一）" });
        } else if (!next.unlocked) {
          const missing = [];
          if (!meetsExposure) missing.push("语境接触 " + next.exposures + "/" + UNLOCK_EXPOSURES);
          if (!meetsStreak) missing.push("连续识别 " + next.streak + "/" + UNLOCK_STREAK);
          if (!meetsMastery) missing.push("掌握分 " + next.mastery + "/" + UNLOCK_MASTERY);
          events.push({ type: "progress", text: "距离解锁：" + missing.join("、") });
        }
      } else if (from === "active") {
        // 输入线复查到主动词也答错 → 直接回炉
        next.level = "passive";
        next.unlocked = false;
        next.conversionStep = 0;
        next.prodFails = (original.prodFails || 0) + 1;
        next.mastery = Math.round(Math.max(0, next.mastery * 0.5));
        events.push({ type: "recycled", text: "识别不稳定，回炉输入线重新积累" });
      }
    } else {
      // ===== 产出线：四级阶梯 + 失败回炉 =====
      if (correct && options.stepPass !== false) {
        next.conversionStep = Math.min(LADDER_STEPS, (original.conversionStep || 0) + 1);
        if (next.conversionStep >= LADDER_STEPS) {
          events.push({ type: "ladder-done", text: "四级阶梯全部通过，进入巩固维护" });
        } else {
          events.push({ type: "ladder-up", text: "阶梯 " + next.conversionStep + " 通过，下一题进入阶梯 " + (next.conversionStep + 1) });
        }
      } else {
        // 产出失败 → 回炉输入线
        next.level = "passive";
        next.unlocked = false;
        next.conversionStep = 0;
        next.prodFails = (original.prodFails || 0) + 1;
        next.mastery = Math.round(Math.max(0, next.mastery * 0.5));
        next.nextReviewAt = new Date().toISOString();
        events.push({ type: "recycled", text: "产出失败，回炉输入线在更多语境中重新积累" });
      }
    }

    words[index] = next;
    addLog({
      type: "review",
      wordId: id,
      word: next.word,
      mode: options.mode || line,
      line,
      correct,
      rating,
      from,
      to: next.level
    });
    events.forEach(event => addLog({
      type: event.type,
      wordId: id,
      word: next.word,
      from,
      to: next.level
    }));
    save();
    return { word: next, events };
  }

  /** 手动解锁主动线（掌握分达标时允许跳过等待）。 */
  function unlockWord(id) {
    const word = getWord(id);
    if (!word) throw new Error("词汇不存在。 ");
    if (word.level === "active") return word;
    if ((word.mastery || 0) < UNLOCK_MASTERY) throw new Error("掌握分需达到 60 才能解锁主动线。 ");
    const from = word.level;
    word.level = "active";
    word.unlocked = true;
    word.conversionStep = 0;
    word.nextReviewAt = new Date().toISOString();
    word.updatedAt = new Date().toISOString();
    addLog({ type: "unlocked", wordId: id, word: word.word, from, to: "active" });
    save();
    return word;
  }

  /** 兼容旧接口：手动把词送入主动线解锁流程。 */
  function startConversion(id) {
    return unlockWord(id);
  }

  /** 兼容旧接口：直接设置阶梯进度。 */
  function setConversionStep(id, step) {
    const word = getWord(id);
    if (!word) return;
    word.conversionStep = Math.max(0, Math.min(LADDER_STEPS, Number(step) || 0));
    word.updatedAt = new Date().toISOString();
    save();
  }

  /** 兼容旧接口：视为阶梯全部通过。 */
  function completeConversion(id) {
    const word = getWord(id);
    if (!word) throw new Error("词汇不存在。 ");
    word.conversionStep = LADDER_STEPS;
    word.mastery = Math.max(75, word.mastery || 0);
    word.wrong = false;
    word.consecutiveWrong = 0;
    word.nextReviewAt = new Date().toISOString();
    word.updatedAt = new Date().toISOString();
    save();
    return word;
  }

  function parseImport(text) {
    const content = String(text || "").trim();
    if (!content) throw new Error("请先粘贴要导入的内容。 ");
    let rows;
    if (content.startsWith("[") || content.startsWith("{")) {
      const parsed = JSON.parse(content);
      rows = Array.isArray(parsed) ? parsed : parsed.words;
      if (!Array.isArray(rows)) throw new Error("JSON 需要是词汇数组，或包含 words 数组。 ");
    } else {
      rows = content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#")).map(line => {
        const delimiter = line.includes("|") ? "|" : ",";
        return line.split(delimiter).map(cell => cell.trim());
      });
    }

    const result = { added: 0, skipped: 0, errors: [] };
    rows.forEach((row, index) => {
      try {
        const candidate = Array.isArray(row) ? {
          word: row[0], phonetic: row[1], pos: row[2], meaning: row[3],
          collocations: row[4], example: row[5], exampleCn: row[6],
          difficulty: row[7], exam: row[8]
        } : row;
        if (!candidate || !String(candidate.word || "").trim() || !String(candidate.meaning || candidate.definition || "").trim()) {
          throw new Error("缺少单词或释义");
        }
        if (findDuplicate(candidate.word)) {
          result.skipped += 1;
          return;
        }
        const word = Data.normalizeWord(candidate, false);
        state.words.unshift(word);
        result.added += 1;
      } catch (error) {
        result.errors.push("第 " + (index + 1) + " 条：" + error.message);
      }
    });
    if (result.added) save();
    return result;
  }

  /** 快速批量添加个人词汇：每行"单词 | 释义"，直接进入指定线路。 */
  function quickAdd(text, level) {
    const targetLevel = Data.LEVELS.includes(level) ? level : "passive";
    const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
    const result = { added: 0, skipped: 0, errors: [] };
    lines.forEach((line, index) => {
      try {
        const parts = line.split("|").map(part => part.trim()).filter(Boolean);
        const word = parts[0];
        const meaning = parts[1] || "";
        if (!word) throw new Error("缺少单词");
        if (findDuplicate(word)) { result.skipped += 1; return; }
        if (!meaning) throw new Error("缺少释义（个人词汇需填写）");
        const entry = Data.normalizeWord({
          word, meaning, level: targetLevel, exam: "custom", difficulty: "中等"
        }, false);
        load().words.unshift(entry);
        result.added += 1;
      } catch (error) {
        result.errors.push("第 " + (index + 1) + " 行：" + error.message);
      }
    });
    if (result.added) save();
    return result;
  }

  /** 批量修改词汇（内置词与个人词均可），一次保存。返回实际修改数量。 */
  function batchUpdate(ids, mutate) {
    const words = load().words;
    let changed = 0;
    ids.forEach(id => {
      const word = words.find(item => item.id === id);
      if (!word) return;
      mutate(word);
      word.updatedAt = new Date().toISOString();
      changed += 1;
    });
    if (changed) save();
    return changed;
  }

  function exportData() {
    save();
    return JSON.stringify({
      version: 2,
      progress: state.progress,
      userWords: state.userWords,
      logs: state.logs,
      settings: state.settings,
      createdAt: state.createdAt,
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  function updateSettings(changes) {
    state.settings = Object.assign({}, state.settings, changes);
    if (changes.ai) state.settings.ai = Object.assign({}, load().settings.ai, changes.ai);
    save();
    return state.settings;
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
    state = defaultState();
    pristine = snapshotPristine();
    save();
    return state;
  }

  function dayKey(value) {
    const date = value ? new Date(value) : new Date();
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function getStats() {
    const current = load();
    const now = new Date();
    const today = dayKey(now);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);
    const todayLogs = current.logs.filter(log => dayKey(log.createdAt) === today);
    const weekLogs = current.logs.filter(log => new Date(log.createdAt) >= weekAgo);
    const levelCount = level => current.words.filter(word => word.level === level);
    const mastered = words => words.filter(word => word.mastery >= 60).length;
    const passive = levelCount("passive");
    const active = levelCount("active");
    const stable = current.words.filter(word => word.unlocked || (word.exposures || 0) >= UNLOCK_EXPOSURES);
    const exposureTotal = current.words.reduce((sum, word) => sum + (word.exposures || 0), 0);
    // 主动线阶梯分布：L1-L4
    const ladder = [1, 2, 3, 4].map(step => ({
      label: "L" + step,
      value: active.filter(word => (word.conversionStep || 0) === step).length
    }));
    const distribution = key => {
      const map = {};
      current.words.forEach(word => { map[word[key]] = (map[word[key]] || 0) + 1; });
      return Object.keys(map).map(label => ({ label, value: map[label] })).sort((a, b) => b.value - a.value);
    };
    const trend = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(now);
      date.setDate(date.getDate() - offset);
      const key = dayKey(date);
      const logs = current.logs.filter(log => log.type === "review" && dayKey(log.createdAt) === key);
      trend.push({
        key,
        label: offset === 0 ? "今天" : (date.getMonth() + 1) + "/" + date.getDate(),
        value: logs.length,
        correct: logs.filter(log => log.correct).length
      });
    }

    return {
      due: current.words.filter(word => SRS.isDue(word)).length,
      passiveDue: passive.filter(word => SRS.isDue(word)).length,
      activeDue: active.filter(word => SRS.isDue(word)).length,
      wrong: current.words.filter(word => word.wrong).length,
      total: current.words.length,
      passive,
      candidate: active, // 兼容旧字段
      active,
      stableCount: stable.length,
      exposureTotal,
      recycleTotal: current.words.filter(word => (word.prodFails || 0) > 0).length,
      ladder,
      passiveMastery: passive.length ? Math.round(mastered(passive) / passive.length * 100) : 0,
      activeMastery: active.length ? Math.round(mastered(active) / active.length * 100) : 0,
      todayAdded: current.words.filter(word => dayKey(word.createdAt) === today && !word.isBuiltin).length,
      todayReviewed: todayLogs.filter(log => log.type === "review").length,
      todayMastered: new Set(todayLogs.filter(log => log.type === "review" && log.correct && log.rating >= 2).map(log => log.wordId)).size,
      weeklyUnlocked: weekLogs.filter(log => log.type === "unlocked").length,
      weeklyRecycled: weekLogs.filter(log => log.type === "recycled").length,
      difficultyDistribution: distribution("difficulty"),
      trend
    };
  }

  window.VocabStore = {
    STORAGE_KEY,
    LEGACY_KEY,
    UNLOCK_EXPOSURES,
    UNLOCK_STREAK,
    UNLOCK_MASTERY,
    LADDER_STEPS,
    load,
    save,
    getState,
    getWord,
    addWord,
    updateWord,
    removeWord,
    recordAttempt,
    unlockWord,
    startConversion,
    setConversionStep,
    completeConversion,
    parseImport,
    quickAdd,
    batchUpdate,
    exportData,
    updateSettings,
    reset,
    getStats,
    dayKey
  };
})();
