/* =========================================================
   词流 · 单页应用控制器（v3 · 双线训练模型）
   路由、页面渲染、双线训练状态机、触控手势、TTS 与弹层交互。
   - 输入线（被动词汇）：受控输入 + 语境复现 + 间隔重复
     复习 = 在新语境中再次偶遇目标词；核心指标是多语境接触与稳定识别
   - 产出线（主动词汇）：强制产出 + 四级阶梯
     L1 首字母填空 → L2 同义替换 → L3 语境挖空 → L4 独立造句
     产出失败 → 回炉输入线，在更多语境中重新积累
   无需框架或网络依赖；直接以 file:// 打开也可运行。
   ========================================================= */
(function () {
  "use strict";

  const Store = window.VocabStore;
  const SRS = window.VocabSRS;
  const Data = window.VocabData;
  const AI = window.VocabAI;

  const ui = {
    route: "home",
    libraryTab: "passive",
    libraryLimit: 30,
    filters: { search: "", difficulty: "全部", mastery: "全部", exam: "全部" },
    session: null,
    librarySet: null,
    batchMode: false,
    selected: new Set(),
    touch: null,
    toastTimer: null,
    lastFocus: null
  };

  const main = document.getElementById("main-content");
  const modalRoot = document.getElementById("modal-root");

  const ROUTES = {
    home: ["DAILY RHYTHM", "今日学习", "让认识的词，真正成为你的表达。"],
    library: ["VOCABULARY", "我的词库", "输入线积累识别，产出线锤炼表达。"],
    review: ["SMART REVIEW", "复习训练", "输入线遇见词，产出线用出词。"],
    stats: ["YOUR PROGRESS", "学习统计", "看见积累，也看见需要回补的地方。"],
    profile: ["PREFERENCES", "我的", "本地存储，简单、私密、可迁移。"]
  };

  const LEVEL_NAMES = { passive: "输入线", active: "产出线" };
  const THEME_NAMES = { green: "清新绿", ios: "iOS 蓝" };
  // 默认主题取自 index.html 的 html[data-theme]（功能版无标记=绿，iOS 副本标记=蓝），换肤后由设置持久化
  const DEFAULT_THEME = document.documentElement.dataset.theme === "ios" ? "ios" : "green";
  const MODE_NAMES = { passive: "输入线 · 语境识别", active: "产出线 · 强制产出", wrong: "错题重练" };
  const TYPE_NAMES = {
    "ctx-choice": "语境选义", "ctx-judge": "语境判断", listen: "听音识义",
    "first-letter": "阶梯一 · 语境首字母填空", "syn-swap": "阶梯二 · 同义替换",
    "cloze-accept": "阶梯三 · 语境挖空填词", sentence: "阶梯四 · 独立造句", maintain: "巩固维护 · 语境挖空"
  };
  const LADDER_LABELS = ["L1 首字母填空", "L2 同义替换", "L3 语境挖空", "L4 独立造句"];

  /** 避免个人词汇内容注入 HTML。 */
  function e(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function icon(name) {
    const paths = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      volume: '<path d="M11 5 6 9H3v6h3l5 4V5ZM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
      book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M8 7h8M8 11h6"/>',
      convert: '<path d="M20 7h-9a4 4 0 0 0-4 4v1"/><path d="m17 4 3 3-3 3M4 17h9a4 4 0 0 0 4-4v-1"/><path d="m7 20-3-3 3-3"/>',
      active: '<path d="m4 13 5 5L20 7"/><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10"/>',
      wrong: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
      arrow: '<path d="m9 18 6-6-6-6"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      upload: '<path d="M12 16V3M7 8l5-5 5 5M4 15v5h16v-5"/>',
      download: '<path d="M12 3v13M7 11l5 5 5-5M4 20h16"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h.09v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
      spark: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
      edit: '<path d="m4 16-1 5 5-1L19 9l-4-4L4 16ZM13 7l4 4"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      data: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      chevronLeft: '<path d="m15 18-6-6 6-6"/>',
      palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M12 21a9 9 0 0 0 9-9 4.5 4.5 0 0 1-4.5-4.5H12a3 3 0 0 0-3 3v10.5Z"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  }

  function levelPill(level) {
    const className = level === "active" ? "active-level" : level;
    return `<span class="pill ${className}">${LEVEL_NAMES[level] || level}</span>`;
  }

  function toast(message, isError) {
    const element = document.getElementById("toast");
    clearTimeout(ui.toastTimer);
    element.textContent = message;
    element.classList.toggle("error", Boolean(isError));
    element.classList.add("show");
    ui.toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
  }

  function setHeader(route) {
    const config = ROUTES[route];
    document.getElementById("page-eyebrow").textContent = config[0];
    document.getElementById("page-title").textContent = config[1];
    document.getElementById("page-subtitle").textContent = config[2];
    document.querySelectorAll(".nav-item").forEach(button => {
      const active = button.dataset.route === route;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    const action = document.getElementById("header-action");
    action.classList.toggle("hidden", route !== "library");
    if (route === "library") {
      action.dataset.action = "add-word";
      action.innerHTML = icon("plus");
      action.setAttribute("aria-label", "新增词汇");
    }
  }

  function render(preserveScroll) {
    const scrollY = window.scrollY;
    setHeader(ui.route);
    const views = { home: renderHome, library: renderLibrary, review: renderReview, stats: renderStats, profile: renderProfile };
    main.innerHTML = `<div class="page" data-page="${ui.route}">${views[ui.route]()}</div>`;
    if (preserveScroll) requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }

  function navigate(route) {
    if (!ROUTES[route]) return;
    ui.route = route;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ------------------------- 首页 ------------------------- */
  function renderHome() {
    const stats = Store.getStats();
    const goal = Store.getState().settings.dailyGoal || 20;
    const progress = Math.min(100, Math.round(stats.todayReviewed / goal * 100));
    const hour = new Date().getHours();
    const greeting = hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
    return `
      <section class="card hero-card" aria-label="今日复习进度">
        <div class="hero-top">
          <div><p class="hero-label">${greeting} · 今日待复习</p><div class="hero-number">${stats.due}<small>词</small></div></div>
          <span class="hero-badge">目标 ${goal} 次</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="progress-meta"><span>今日已完成 ${stats.todayReviewed} 次</span><span>${progress}%</span></div>
      </section>
      <div class="stat-grid">
        <div class="card mini-stat"><strong>${stats.stableCount}</strong><span>稳定识别</span></div>
        <div class="card mini-stat"><strong>${stats.exposureTotal}</strong><span>语境接触</span></div>
        <div class="card mini-stat"><strong>${stats.total}</strong><span>词汇总量</span></div>
      </div>
      <section class="section">
        <div class="section-heading"><h2>开始今天的练习</h2><p>输入线积累 · 产出线锤炼</p></div>
        <div class="quick-grid">
          ${quickCard("passive", "book", "输入线 · 语境识别", "在语境中再次偶遇", stats.passiveDue)}
          ${quickCard("active", "active", "产出线 · 强制产出", "四级阶梯逐级通关", stats.activeDue)}
          ${quickCard("wrong", "wrong", "错题本", "答对自动移出", stats.wrong)}
        </div>
      </section>
      <section class="section">
        <div class="tip-card">${icon("info")}<p><strong>双线训练提示</strong><br>输入线不是“看词选义”，而是在新材料中再次遇见目标词；接触满 3 个语境、连续识别 2 轮且掌握分达 60，即解锁产出线。产出失败会自动回炉，在更多语境中重新积累。</p></div>
      </section>`;
  }

  function quickCard(mode, iconName, title, subtitle, count) {
    return `<button class="quick-card" type="button" data-action="start-session" data-mode="${mode}">
      <span class="quick-count">${count} 待练</span><span class="quick-icon">${icon(iconName)}</span>
      <strong>${title}</strong><small>${subtitle}</small>
    </button>`;
  }

  /* ------------------------- 词库 ------------------------- */
  function getFilteredWords() {
    const filters = ui.filters;
    const query = filters.search.trim().toLowerCase();
    return Store.getState().words.filter(word => {
      if (word.level !== ui.libraryTab) return false;
      if (query && !(word.word + " " + word.meaning + " " + word.collocations.join(" ")).toLowerCase().includes(query)) return false;
      if (filters.difficulty !== "全部" && word.difficulty !== filters.difficulty) return false;
      if (filters.exam !== "全部" && word.exam !== filters.exam) return false;
      if (filters.mastery === "未掌握" && word.mastery >= 30) return false;
      if (filters.mastery === "学习中" && (word.mastery < 30 || word.mastery >= 60)) return false;
      if (filters.mastery === "已掌握" && word.mastery < 60) return false;
      return true;
    }).sort((a, b) => a.word.localeCompare(b.word));
  }

  function renderLibrary() {
    const words = Store.getState().words;
    const counts = level => words.filter(word => word.level === level).length;
    const filtered = getFilteredWords();
    const visible = filtered.slice(0, ui.libraryLimit);
    const chips = (key, values) => `<div class="filter-row" aria-label="按${key}筛选">${values.map(value => `<button class="filter-chip ${ui.filters[key] === value ? "active" : ""}" type="button" data-action="filter" data-key="${key}" data-value="${e(value)}">${e(value)}</button>`).join("")}</div>`;
    return `
      <div class="segmented" role="tablist" aria-label="词汇线路">
        ${["passive", "active"].map(level => `<button type="button" role="tab" aria-selected="${ui.libraryTab === level}" class="${ui.libraryTab === level ? "active" : ""}" data-action="library-tab" data-level="${level}">${LEVEL_NAMES[level]} ${counts(level)}</button>`).join("")}
      </div>
      <div class="search-box">${icon("search")}<input class="search-input" id="library-search" type="search" placeholder="搜索单词、释义或搭配" value="${e(ui.filters.search)}" autocomplete="off">${ui.filters.search ? '<button class="search-clear" type="button" data-action="clear-search" aria-label="清除搜索">×</button>' : ""}</div>
      ${chips("difficulty", ["全部", "简单", "中等", "困难"])}
      ${chips("mastery", ["全部", "未掌握", "学习中", "已掌握"])}
      ${chips("exam", ["全部", "CET4", "CET6", "custom"])}
      <div class="list-toolbar">
        <button class="text-button" type="button" data-action="quick-add">＋ 快速添加</button>
        <button class="text-button" type="button" data-action="toggle-batch">${ui.batchMode ? "退出批量管理" : "批量管理"}</button>
      </div>
      ${ui.batchMode ? `<p class="batch-hint">批量模式：点击词条即可勾选，选中后使用底部操作栏。</p>` : ""}
      ${visible.length ? `<div class="word-list">${visible.map(renderWordRow).join("")}</div>` : renderEmpty("没有匹配的词汇", "调整筛选条件，或使用快速添加。", "quick-add", "快速添加词汇")}
      ${filtered.length > visible.length ? `<button class="secondary-button full-width section" type="button" data-action="show-more">再显示 ${Math.min(30, filtered.length - visible.length)} 条</button>` : ""}
      ${ui.batchMode ? renderBatchBar(filtered) : ""}
      <p class="list-footer">共 ${filtered.length} 条 · ${ui.batchMode ? "批量模式已开启" : "点击词汇查看详情与编辑"}</p>`;
  }

  function renderBatchBar(filtered) {
    const ids = filtered.map(word => word.id);
    const allSelected = ids.length > 0 && ids.every(id => ui.selected.has(id));
    return `<div class="batch-bar card" role="toolbar" aria-label="批量操作">
      <button class="mini-action" type="button" data-action="batch-select-all" data-all="${allSelected ? "1" : ""}">${allSelected ? "取消全选" : "全选"}</button>
      <span class="batch-count">已选 ${ui.selected.size}</span>
      <button class="mini-action" type="button" data-action="batch-unlock">解锁主动线</button>
      <button class="mini-action" type="button" data-action="batch-passive">回输入线</button>
      <button class="mini-action" type="button" data-action="batch-clearwrong">清错题</button>
      <button class="mini-action danger" type="button" data-action="batch-delete">删个人词</button>
    </div>`;
  }

  function renderWordRow(word, index) {
    const selected = ui.batchMode && ui.selected.has(word.id);
    return `<button class="word-row ${selected ? "row-selected" : ""}" type="button" data-action="${ui.batchMode ? "toggle-select" : "open-word"}" data-id="${e(word.id)}" style="animation-delay:${Math.min(index, 8) * 22}ms">
      <div class="word-row-top"><span class="row-check" aria-hidden="true">${selected ? "✓" : ""}</span><div><div class="word-title"><strong>${e(word.word)}</strong><span>${e(word.phonetic)}</span></div><p class="word-meaning">${e(word.pos)} ${e(word.meaning)}</p></div>${levelPill(word.level)}</div>
      <div class="word-row-meta"><span class="pill">${e(word.exam)}</span><span class="pill">${e(word.difficulty)}</span>${word.level === "passive" ? `<span class="pill">接触 ${(word.exposures || 0)}/3</span>` : `<span class="pill">阶梯 L${Math.max(1, Math.min(4, word.conversionStep || 1))}</span>`}${word.wrong ? '<span class="pill wrong">错题</span>' : ""}</div>
      <div class="mastery-line"><div class="progress-track"><div class="progress-fill" style="width:${word.mastery}%"></div></div><small>${word.mastery}%</small></div>
    </button>`;
  }

  function renderEmpty(title, text, action, actionText) {
    return `<div class="card empty-state"><div class="empty-illustration">${icon("book")}</div><h3>${e(title)}</h3><p>${e(text)}</p>${action ? `<button class="primary-button" type="button" data-action="${action}">${e(actionText)}</button>` : ""}</div>`;
  }

  /* ------------------------- 复习入口 ------------------------- */
  function getQueue(mode) {
    let words = Store.getState().words.slice();
    if (mode === "wrong") words = words.filter(word => word.wrong);
    else words = words.filter(word => word.level === mode && SRS.isDue(word));
    words.sort((a, b) => {
      if (mode === "wrong") return b.wrongCount - a.wrongCount;
      if (mode === "active") return (a.conversionStep || 0) - (b.conversionStep || 0) || a.mastery - b.mastery;
      return new Date(a.nextReviewAt) - new Date(b.nextReviewAt) || a.mastery - b.mastery;
    });
    const goal = Store.getState().settings.dailyGoal || 20;
    return words.slice(0, goal);
  }

  function renderReview() {
    if (ui.session) return renderSession();
    const stats = Store.getStats();
    return `
      <div class="mode-list">
        ${modeCard("passive", "Aa", "输入线 · 语境识别", "语境选义 · 语境判断 · 听音识义", stats.passiveDue)}
        ${modeCard("active", "→", "产出线 · 强制产出", "首字母 → 同义替换 → 挖空 → 造句", stats.activeDue)}
        ${modeCard("wrong", "×", "错题重练", "集中修复薄弱点，答对即移出", stats.wrong)}
      </div>
      <section class="section"><div class="tip-card">${icon("clock")}<p><strong>本轮最多 ${Store.getState().settings.dailyGoal} 张卡片</strong><br>输入线答对一次记一次有效语境接触；产出线按当前阶梯出题，失败自动回炉输入线。左右或上下轻滑可跳过当前卡片。</p></div></section>
      <section class="section"><div class="section-heading"><h2>本周双线流转</h2></div><div class="week-grid"><div class="card week-card"><strong>${stats.weeklyUnlocked}</strong><span>识别稳定 · 解锁主动线</span></div><div class="card week-card"><strong>${stats.weeklyRecycled}</strong><span>产出失败 · 回炉输入线</span></div></div></section>`;
  }

  function modeCard(mode, symbol, title, subtitle, count) {
    return `<button class="mode-card" type="button" data-action="start-session" data-mode="${mode}"><span class="mode-symbol">${symbol}</span><span class="mode-copy"><strong>${title}</strong><small>${subtitle}</small></span><span class="mode-count">${count}</span>${icon("arrow")}</button>`;
  }

  function startSession(mode) {
    const queue = getQueue(mode);
    if (!queue.length) {
      toast(mode === "wrong" ? "错题本是空的，保持得不错。" : mode === "active" ? "产出线暂无到期词汇，先去输入线积累语境接触。" : "输入线暂无到期词汇。 ");
      return;
    }
    // 缓存词库单词集合，用于语境材料已知词覆盖率估算
    ui.librarySet = new Set(Store.getState().words.map(word => word.word.toLowerCase()));
    ui.session = {
      mode,
      queue: queue.map(word => word.id),
      index: 0,
      phase: "question",
      question: null,
      selected: null,
      userAnswer: "",
      correct: null,
      answeredIds: [],
      results: { correct: 0, wrong: 0, skipped: 0 },
      completed: false
    };
    ui.route = "review";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function currentWord() {
    if (!ui.session) return null;
    return Store.getWord(ui.session.queue[ui.session.index]);
  }

  function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function makeOptions(word, field, count) {
    const correct = field === "meaning" ? word.meaning : (word.collocations[0] || word.word);
    const pool = Store.getState().words.filter(item => item.id !== word.id).map(item => field === "meaning" ? item.meaning : (item.collocations[0] || item.word)).filter(value => value && value !== correct);
    const options = shuffle([correct].concat(shuffle([...new Set(pool)]).slice(0, Math.max(0, (count || 4) - 1))));
    return { options, correctIndex: options.indexOf(correct), correctAnswer: correct };
  }

  /* ---------------- 语境材料（输入线核心） ---------------- */
  function wordContexts(word) {
    return word.contexts && word.contexts.length ? word.contexts : [{ text: word.example || "", cn: word.exampleCn || "" }];
  }

  /** 选一条语境：优先选没接触过的（语境复现=在新材料中偶遇）。 */
  function pickContext(word, preferOffset) {
    const contexts = wordContexts(word).map((context, index) => ({ context, index })).filter(item => item.context.text);
    if (!contexts.length) return null;
    const seen = Array.isArray(word.seenContexts) ? word.seenContexts : [];
    const unseen = contexts.filter(item => !seen.includes(item.index));
    const pool = unseen.length ? unseen : contexts;
    const offset = Math.max(0, Number(preferOffset) || 0);
    return pool[(ui.session.index + (word.correctCount || 0) + offset) % pool.length];
  }

  /** 在语境句中高亮目标词。 */
  function highlightContext(text, word) {
    const escaped = String(word.word || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const marked = String(text || "").replace(new RegExp("(" + escaped + ")", "gi"), '<mark class="ctx-mark">$1</mark>');
    return e(text) === marked ? e(text) : marked;
  }

  /** 把目标词挖空。 */
  function clozeContext(word, context) {
    const text = (context && context.text) || word.example || "";
    if (!text) return "";
    const escaped = String(word.word || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const replaced = text.replace(new RegExp(escaped, "i"), "______");
    return replaced === text ? text + "（目标词：______）" : replaced;
  }

  /** 已知词覆盖率估算（对内置词库而言）。 */
  function coverageOf(sentence) {
    const tokens = (String(sentence || "").toLowerCase().match(/[a-zA-Z]+(?:['-][a-zA-Z]+)?/g) || []);
    if (!tokens.length || !ui.librarySet) return 0;
    const known = tokens.filter(token => ui.librarySet.has(token)).length;
    return Math.round(known / tokens.length * 100);
  }

  /** 语境材料块。hideCn=true 时隐藏中文翻译（识别题型需要防止翻译直接暴露词义）。 */
  function ctxBlock(word, context, mode, hideCn) {
    const body = mode === "cloze" ? e(clozeContext(word, context)) : highlightContext(context.text, word);
    const coverage = coverageOf(context.text);
    const contexts = wordContexts(word);
    return `<div class="ctx-sentence" aria-label="语境例句">${body}${context.cn && !hideCn ? `<p class="ctx-cn">${e(context.cn)}</p>` : ""}</div>
      <div class="ctx-meta"><span class="badge">语境 ${context.index + 1}/${contexts.length}</span><span class="badge">已接触 ${(word.exposures || 0)} 次</span><span class="badge ${coverage >= 95 && coverage <= 98 ? "ok" : ""}">已知词覆盖 ${coverage}%</span></div>`;
  }

  /* ---------------- 出题（双线状态机） ---------------- */
  function getQuestion() {
    const session = ui.session;
    if (session.question) return session.question;
    const word = currentWord();
    const baseMode = session.mode === "wrong" ? (word.level === "active" ? "active" : "passive") : session.mode;
    const question = baseMode === "passive" ? inputQuestion(word) : activeQuestion(word);
    session.question = question;
    return question;
  }

  /** 输入线：受控输入 + 语境复现。三种识别任务轮换。 */
  function inputQuestion(word) {
    const type = ["ctx-choice", "ctx-judge", "listen"][(ui.session.index + (word.correctCount || 0)) % 3];
    const question = { type, line: "passive" };
    if (type === "listen") return Object.assign(question, makeOptions(word, "meaning"));
    const picked = pickContext(word);
    if (picked) {
      question.contextIndex = picked.index;
      question.context = picked.context;
    }
    if (type === "ctx-choice") Object.assign(question, makeOptions(word, "meaning"));
    if (type === "ctx-judge") {
      const showCorrect = Math.random() > 0.5;
      const other = shuffle(Store.getState().words.filter(item => item.id !== word.id))[0];
      question.proposedMeaning = showCorrect ? word.meaning : (other ? other.meaning : word.meaning);
      question.options = ["释义匹配", "释义不匹配"];
      question.correctIndex = showCorrect ? 0 : 1;
      question.correctAnswer = word.meaning;
    }
    return question;
  }

  /** 产出线：四级阶梯。L1 首字母 → L2 同义替换 → L3 多解挖空 → L4 独立造句。 */
  function activeQuestion(word) {
    const step = word.conversionStep || 0;
    if (step >= Store.LADDER_STEPS) return maintainQuestion(word, "maintain");
    const type = ["first-letter", "syn-swap", "cloze-accept", "sentence"][step];
    const question = { type, line: "active", step: step + 1 };
    const picked = pickContext(word, step);
    if (picked) {
      question.contextIndex = picked.index;
      question.context = picked.context;
    }
    if (type === "first-letter") {
      question.correctAnswer = word.word;
      question.hint = word.word.charAt(0).toUpperCase() + "·" + "_".repeat(Math.max(1, word.word.length - 1));
    } else if (type === "syn-swap") {
      const synonym = (word.synonyms || [])[0];
      if (synonym) {
        question.synonym = synonym;
        question.correctAnswer = word.word;
      } else {
        // 无同义词 → 降级为首字母填空（换一条语境）
        question.type = "first-letter";
        question.fallback = true;
        question.correctAnswer = word.word;
        question.hint = word.word.charAt(0).toUpperCase() + "·" + "_".repeat(Math.max(1, word.word.length - 1));
        const alt = pickContext(word, step + 1);
        if (alt) { question.contextIndex = alt.index; question.context = alt.context; }
      }
    } else if (type === "cloze-accept") {
      // 多解：目标词 + 词库内同位置词性的同近义词
      const accepted = [word.word.toLowerCase()];
      (word.synonyms || []).forEach(synonym => {
        const target = Data.findByWord(synonym, Store.getState().words);
        if (target && target.id !== word.id && target.pos === word.pos) accepted.push(target.word.toLowerCase());
      });
      question.accepted = accepted;
      question.correctAnswer = word.word;
      question.multi = accepted.length > 1;
    } else if (type === "sentence") {
      question.correctAnswer = word.word;
    }
    return question;
  }

  /** 巩固维护（阶梯已通关）：语境挖空 + 多解。 */
  function maintainQuestion(word, type) {
    const question = { type, line: "active", step: Store.LADDER_STEPS };
    const picked = pickContext(word, 2);
    if (picked) {
      question.contextIndex = picked.index;
      question.context = picked.context;
    }
    const accepted = [word.word.toLowerCase()];
    (word.synonyms || []).forEach(synonym => {
      const target = Data.findByWord(synonym, Store.getState().words);
      if (target && target.id !== word.id && target.pos === word.pos) accepted.push(target.word.toLowerCase());
    });
    question.accepted = accepted;
    question.correctAnswer = word.word;
    question.multi = accepted.length > 1;
    return question;
  }

  /* ---------------- 会话渲染 ---------------- */
  function renderSession() {
    const session = ui.session;
    if (session.completed) return renderCompletion();
    const word = currentWord();
    if (!word) {
      session.completed = true;
      return renderCompletion();
    }
    const question = getQuestion();
    const progress = Math.round(session.index / session.queue.length * 100);
    const feedbackClass = session.phase === "feedback" ? (session.correct ? "correct" : "wrong-answer") : "";
    const isInput = question.line === "passive";
    const ladderDots = isInput ? "" : `<div class="stepper" aria-label="产出阶梯进度">${[1, 2, 3, 4].map(step => `<span class="step-dot ${step <= (word.conversionStep || 0) ? "done" : ""}"></span>`).join("")}<small>${LADDER_LABELS[Math.min(3, word.conversionStep || 0)]}</small></div>`;
    return `
      <div class="session-top"><button class="icon-button" type="button" data-action="end-session" aria-label="退出本轮">${icon("close")}</button><div class="session-progress"><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div></div><span class="session-counter">${session.index + 1} / ${session.queue.length}</span></div>
      ${ladderDots}
      <p class="swipe-hint">${MODE_NAMES[session.mode]} · 轻滑卡片可跳过</p>
      <div class="review-stage" id="review-stage">
        <article class="review-card ${feedbackClass}" id="review-card">
          <div class="review-type"><span>${TYPE_NAMES[question.type]}${isInput ? " · 输入线" : ` · 阶梯 ${question.step}/4`}</span><button class="icon-button soft" type="button" data-action="speak-current" aria-label="朗读单词">${icon("volume")}</button></div>
          ${renderQuestionBody(word, question)}
          ${session.phase === "feedback" ? renderFeedback(word, question) : ""}
        </article>
        ${session.phase === "feedback" && !session.correct ? renderAnswerCard(word, question) : ""}
      </div>
      <div class="session-bottom">${session.phase === "question" ? '<button class="text-button full-width" type="button" data-action="skip-card">稍后再练 · 跳过此卡</button>' : renderRatingPanel(word)}</div>`;
  }

  function renderQuestionBody(word, question) {
    const disabled = ui.session.phase === "feedback" ? "disabled" : "";
    let prompt = "";
    let controls = "";
    if (question.type === "ctx-choice" || question.type === "ctx-judge") {
      prompt = `<div class="review-prompt"><p class="review-question">${question.type === "ctx-choice" ? "结合语境，选择目标词的含义" : "判断释义是否匹配当前语境"}</p></div>
        ${question.context ? ctxBlock(word, question.context, null, true) : `<div class="ctx-sentence">${e(word.example || "暂无语境材料")}</div>`}
        ${question.type === "ctx-judge" ? `<div class="answer-reveal"><strong>${e(question.proposedMeaning)}</strong></div>` : ""}`;
    } else if (question.type === "listen") {
      prompt = `<div class="review-prompt"><button class="listen-button" type="button" data-action="speak-current" aria-label="播放发音">${icon("volume")}</button><p class="review-question">听发音，选择对应释义</p></div>`;
    } else if (question.type === "first-letter") {
      prompt = `<div class="review-prompt"><p class="review-question">有线索的受控产出：根据语境与首字母写出目标词</p></div>
        ${question.context ? ctxBlock(word, question.context, "cloze") : `<div class="ctx-sentence">${e(clozeContext(word, null))}</div>`}
        <div class="hint-row"><span class="hint-letters">${e(question.hint || "")}</span><span class="badge">${e(word.meaning)}</span></div>`;
    } else if (question.type === "syn-swap") {
      prompt = `<div class="review-prompt"><p class="review-question">同义替换：写出与下方同义词匹配的目标词</p></div>
        ${question.context ? ctxBlock(word, question.context, "cloze") : `<div class="ctx-sentence">${e(clozeContext(word, null))}</div>`}
        <div class="hint-row"><span class="badge syn">同义词：${e(question.synonym || "")}</span><span class="badge">${e(word.meaning)}</span></div>`;
    } else if (question.type === "cloze-accept" || question.type === "maintain") {
      prompt = `<div class="review-prompt"><p class="review-question">根据中文释义与语境，把目标词填入句中${question.multi ? "（存在多个可接受答案）" : ""}</p></div>
        ${question.context ? ctxBlock(word, question.context, "cloze") : `<div class="ctx-sentence">${e(clozeContext(word, null))}</div>`}
        <div class="hint-row"><span class="badge">${e(word.pos)} ${e(word.meaning)}</span></div>`;
    } else if (question.type === "sentence") {
      prompt = `<div class="review-prompt"><div class="review-word" style="font-family:inherit;font-size:25px">${e(word.meaning)}</div><div class="review-phonetic">${e(word.pos)}</div><p class="review-question">独立造句：不看原词，用它写一个与自己相关的完整句子（至少 6 个英文单词）</p></div>`;
    }

    if (question.options) {
      controls = `<div class="option-list">${question.options.map((option, index) => {
        let className = "";
        if (ui.session.phase === "feedback") {
          if (index === ui.session.selected) className = ui.session.correct ? "selected-correct" : "selected-wrong";
          if (!ui.session.correct && index === question.correctIndex) className += " actual-correct";
        }
        return `<button class="option-button ${className}" type="button" data-action="select-option" data-index="${index}" ${disabled}>${e(option)}</button>`;
      }).join("")}</div>`;
    } else if (["first-letter", "syn-swap", "cloze-accept", "maintain"].includes(question.type)) {
      controls = answerForm(`<input class="answer-input" name="answer" type="text" inputmode="latin" autocapitalize="off" autocomplete="off" placeholder="输入英文单词" value="${e(ui.session.userAnswer)}" ${disabled} required>`, disabled);
    } else if (question.type === "sentence") {
      controls = answerForm(`<textarea class="sentence-input" name="sentence" placeholder="Write your own sentence here..." ${disabled} required>${e(ui.session.userAnswer)}</textarea>`, disabled);
    }
    return prompt + controls;
  }

  function answerForm(fields, disabled) {
    return `<form id="answer-form">${fields}${disabled ? "" : '<button class="primary-button full-width inline-submit" type="submit">确认答案</button>'}</form>`;
  }

  function renderFeedback(word, question) {
    const correct = ui.session.correct;
    let detail = correct ? "回答正确。" : `正确答案：${question.correctAnswer || word.word}`;
    if (question.type === "sentence" && correct) detail = "句子已包含目标词且长度达标。建议再检查语法与搭配。";
    return `<div class="feedback-banner ${correct ? "good" : "bad"}">${icon(correct ? "check" : "wrong")}<div><strong>${correct ? "回答正确" : "需要再巩固"}</strong><p>${e(detail)}</p></div></div>`;
  }

  /** 答错时，在词卡下方另起一块“正确答案”词框。 */
  function renderAnswerCard(word, question) {
    const context = question.context || (word.contexts && word.contexts[0]) || { text: word.example, cn: word.exampleCn };
    return `<aside class="answer-card" aria-label="正确答案">
      <div class="answer-card-head"><span class="badge ok">正确答案</span><strong>${e(word.word)}</strong><span class="muted">${e(word.phonetic)} · ${e(word.pos)}</span></div>
      <p class="answer-meaning">${e(word.meaning)}</p>
      ${context && context.text ? `<div class="ctx-sentence">${highlightContext(context.text, word)}${context.cn ? `<p class="ctx-cn">${e(context.cn)}</p>` : ""}</div>` : ""}
      ${word.collocations.length ? `<p class="ctx-meta"><span class="badge">搭配：${e(word.collocations.slice(0, 2).join(" · "))}</span></p>` : ""}
    </aside>`;
  }

  function renderRatingPanel(word) {
    const session = ui.session;
    const question = getQuestion();
    if (question.line === "passive") {
      if (!session.correct) return `<div class="rating-panel"><p>已加入错题本，并安排当日重测 · 继续在语境中积累接触次数</p><button class="primary-button full-width" type="button" data-action="rate-answer" data-rating="0">继续下一张</button></div>`;
      const exposures = word.exposures || 0;
      const gate = exposures >= Store.UNLOCK_EXPOSURES && (word.streak || 0) >= Store.UNLOCK_STREAK && word.mastery >= Store.UNLOCK_MASTERY;
      const gateNote = gate ? "识别已稳定，本轮结束后解锁主动线" : `解锁条件：接触 ${Math.min(exposures + 1, Store.UNLOCK_EXPOSURES)}/${Store.UNLOCK_EXPOSURES} · 连对 ${word.streak || 0}/${Store.UNLOCK_STREAK} · 掌握 ${word.mastery}/${Store.UNLOCK_MASTERY}`;
      return `<div class="rating-panel"><p>这次回忆有多轻松？<br><small>${e(gateNote)}</small></p><div class="rating-grid">${SRS.RATINGS.slice(1).map(rating => `<button class="rating-button" type="button" data-action="rate-answer" data-rating="${rating.value}">${rating.label}<small>${rating.interval}</small></button>`).join("")}</div></div>`;
    }
    // 产出线
    if (session.correct) {
      const nextStep = Math.min(Store.LADDER_STEPS, (word.conversionStep || 0) + 1);
      const label = nextStep >= Store.LADDER_STEPS ? "阶梯全部通过 · 进入巩固维护" : `本步通过 · 下一题进入 ${LADDER_LABELS[nextStep - 1].split(" ")[0]}`;
      return `<div class="rating-panel"><p>${e(label)}</p><button class="primary-button full-width" type="button" data-action="rate-answer" data-rating="3">继续</button></div>`;
    }
    return `<div class="rating-panel"><p>产出失败：该词已回炉输入线，将在更多语境中重新积累后再解锁</p><button class="primary-button full-width" type="button" data-action="rate-answer" data-rating="0">回炉继续</button></div>`;
  }

  function renderCompletion() {
    const result = ui.session.results;
    const total = result.correct + result.wrong;
    const accuracy = total ? Math.round(result.correct / total * 100) : 0;
    return `<section class="card completion-card"><div class="completion-ring">${icon("check")}</div><h2>本轮学习完成</h2><p>每一次语境偶遇与主动产出，都在加固词汇通路。</p><div class="result-grid"><div><strong>${result.correct}</strong><span>答对</span></div><div><strong>${result.wrong}</strong><span>待巩固</span></div><div><strong>${accuracy}%</strong><span>正确率</span></div></div><button class="primary-button full-width" type="button" data-action="end-session">返回复习中心</button><button class="text-button full-width" type="button" data-route="home">回到今日学习</button></section>`;
  }

  function acceptedAnswers(question, word) {
    if (Array.isArray(question.accepted) && question.accepted.length) return question.accepted;
    return [String(question.correctAnswer || word.word).toLowerCase()];
  }

  function submitAnswer(answer, sentence) {
    const session = ui.session;
    if (!session || session.phase !== "question") return;
    const word = currentWord();
    const question = getQuestion();
    const normalized = String(answer || "").trim().toLowerCase();
    let correct = false;
    if (["first-letter", "syn-swap", "cloze-accept", "maintain"].includes(question.type)) {
      correct = acceptedAnswers(question, word).includes(normalized);
    }
    if (question.type === "sentence") correct = sentenceContainsWord(sentence, word.word) && wordCount(sentence) >= 6;
    session.userAnswer = answer || "";
    session.sentenceAnswer = sentence || "";
    session.correct = correct;
    session.phase = "feedback";
    session.results[correct ? "correct" : "wrong"] += 1;
    render(true);
  }

  function selectOption(index) {
    const session = ui.session;
    if (!session || session.phase !== "question") return;
    const question = getQuestion();
    session.selected = Number(index);
    session.correct = session.selected === question.correctIndex;
    session.phase = "feedback";
    session.results[session.correct ? "correct" : "wrong"] += 1;
    render(true);
  }

  function sentenceContainsWord(sentence, word) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-zA-Z])" + escaped + "([^a-zA-Z]|$)", "i").test(String(sentence || ""));
  }

  function wordCount(sentence) {
    return (String(sentence || "").trim().match(/[a-zA-Z]+(?:['-][a-zA-Z]+)?/g) || []).length;
  }

  function rateAnswer(rating) {
    const session = ui.session;
    if (!session || session.phase !== "feedback") return;
    const word = currentWord();
    const correct = session.correct;
    const question = getQuestion();
    const record = Store.recordAttempt(word.id, {
      correct,
      rating,
      line: question.line,
      mode: session.mode,
      contextIndex: question.contextIndex,
      stepPass: correct
    });
    if (record.events.length) toast(record.events[0].text);
    if (!session.answeredIds.includes(word.id)) session.answeredIds.push(word.id);
    nextCard();
  }

  function nextCard(skipped) {
    const session = ui.session;
    if (!session) return;
    if (skipped) session.results.skipped += 1;
    session.index += 1;
    session.phase = "question";
    session.question = null;
    session.selected = null;
    session.userAnswer = "";
    session.sentenceAnswer = "";
    session.correct = null;
    if (session.index >= session.queue.length) session.completed = true;
    render(true);
  }

  function previousCard() {
    const session = ui.session;
    if (!session || session.index <= 0) return toast("已经是第一张卡片。 ");
    const previousId = session.queue[session.index - 1];
    if (session.answeredIds.includes(previousId)) return toast("已评分卡片不能重复计分。 ");
    session.index -= 1;
    session.phase = "question";
    session.question = null;
    session.selected = null;
    session.userAnswer = "";
    session.sentenceAnswer = "";
    session.correct = null;
    render(true);
  }

  function animateCard(direction, callback) {
    const card = document.getElementById("review-card");
    if (!card) return callback();
    card.classList.add(direction === "left" ? "swipe-left" : direction === "right" ? "swipe-right" : "swipe-up");
    setTimeout(callback, 180);
  }

  /* ------------------------- 统计 ------------------------- */
  function renderStats() {
    const stats = Store.getStats();
    const maxTrend = Math.max(1, ...stats.trend.map(day => day.value));
    const ladderTotal = Math.max(1, stats.active.length);
    return `
      <section class="card metric-card"><div class="metric-top"><div><div class="metric-title"><span class="level-dot"></span><h3>输入线 · 被动词汇</h3></div><p class="caption" style="margin-top:5px">受控输入 + 语境复现 + 间隔重复</p></div><div class="metric-number">${stats.passive.length}<small> 词</small></div></div><div class="progress-track"><div class="progress-fill" style="width:${stats.passiveMastery}%;background:var(--info)"></div></div><div class="progress-meta"><span>稳定识别 ${stats.stableCount} 词 · 累计语境接触 ${stats.exposureTotal} 次</span><span>掌握率 ${stats.passiveMastery}%</span></div></section>
      <section class="card metric-card"><div class="metric-top"><div><div class="metric-title"><span class="level-dot active-dot"></span><h3>产出线 · 主动词汇</h3></div><p class="caption" style="margin-top:5px">强制产出 + 四级阶梯</p></div><div class="metric-number">${stats.active.length}<small> 词</small></div></div><div class="progress-track"><div class="progress-fill" style="width:${stats.activeMastery}%"></div></div><div class="progress-meta"><span>稳定掌握 ${stats.active.filter(word => word.mastery >= 60).length} 词</span><span>掌握率 ${stats.activeMastery}%</span></div></section>
      <section class="section card metric-card"><div class="section-heading"><h2>产出阶梯分布</h2><p>四级任务逐级通过</p></div><div class="bar-list">${stats.ladder.map(item => `<div class="bar-item"><div class="bar-item-top"><span>${item.label}</span><span>${item.value} 词 · ${Math.round(item.value / ladderTotal * 100)}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${item.value / ladderTotal * 100}%"></div></div></div>`).join("")}</div></section>
      <section class="section"><div class="section-heading"><h2>本周双线流转</h2><p>累计回炉 ${stats.recycleTotal} 词</p></div><div class="week-grid"><div class="card week-card"><strong>${stats.weeklyUnlocked}</strong><span>识别稳定 · 解锁主动线</span></div><div class="card week-card"><strong>${stats.weeklyRecycled}</strong><span>产出失败 · 回炉输入线</span></div></div></section>
      <section class="section card metric-card"><div class="section-heading"><h2>近 7 日学习趋势</h2><p>复习次数</p></div><div class="trend-chart">${stats.trend.map(day => `<div class="trend-day"><span class="trend-value">${day.value || ""}</span><div class="trend-bar-wrap"><div class="trend-bar" style="height:${Math.max(3, day.value / maxTrend * 100)}%"></div></div><small>${day.label}</small></div>`).join("")}</div></section>
      <section class="section card metric-card"><div class="section-heading"><h2>难度分布</h2></div>${barList(stats.difficultyDistribution, stats.total)}</section>`;
  }

  function barList(items, total) {
    if (!items.length) return '<p class="caption">暂无数据</p>';
    return `<div class="bar-list">${items.map(item => `<div class="bar-item"><div class="bar-item-top"><span>${e(item.label)}</span><span>${item.value} 词 · ${total ? Math.round(item.value / total * 100) : 0}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${total ? item.value / total * 100 : 0}%"></div></div></div>`).join("")}</div>`;
  }

  /* ------------------------- 我的 ------------------------- */
  function renderProfile() {
    const settings = Store.getState().settings;
    return `
      <section class="card profile-card"><div class="profile-avatar">L</div><div><h2>我的词汇成长空间</h2><p>${Store.getState().words.filter(word => word.isBuiltin).length} 条内置核心词 · 数据仅保存在当前浏览器</p></div></section>
      <section class="section"><div class="section-heading"><h2>学习偏好</h2></div><div class="card settings-list">
        ${settingRow("study-settings", "target", "学习目标与发音", `每日 ${settings.dailyGoal} 次 · 语速 ${settings.ttsRate}x`)}
        ${settingRow("ai-settings", "spark", "AI 拓展配置", settings.ai.endpoint ? "接口已配置" : "例句生成 · 造句批改 · 升级评估")}
      </div></section>
      <section class="section"><div class="section-heading"><h2>数据管理</h2></div><div class="card settings-list">
        ${settingRow("import-words", "upload", "批量导入词汇", "支持 JSON、竖线或逗号分隔文本")}
        ${settingRow("export-data", "download", "导出完整备份", "词汇、设置与学习日志")}
        ${settingRow("import-backup", "upload", "导入备份 / 恢复进度", "选择之前导出的 JSON 备份文件，覆盖当前进度")}
        ${settingRow("reset-data", "trash", "恢复初始词库", "将清除个人词汇和学习记录")}
      </div></section>
      <section class="section"><div class="ai-note"><strong>关于 AI 接口</strong><br>默认完全离线。配置后仅在你主动点击 AI 功能时发送相关单词或句子；密钥保存在本机。公开部署时建议改用服务端代理。</div></section>
      <p class="list-footer">词流 Lexicon Flow · v3.0 · 双线训练模型<br>无需注册 · 无广告 · 支持离线学习</p>`;
  }

  function settingRow(action, iconName, title, subtitle) {
    return `<button class="setting-row" type="button" data-action="${action}"><span class="setting-icon">${icon(iconName)}</span><span class="setting-copy"><strong>${title}</strong><small>${subtitle}</small></span><span class="chevron">›</span></button>`;
  }

  /* ------------------------- 主题切换 ------------------------- */
  function applyTheme(theme) {
    const value = theme === "ios" ? "ios" : "green";
    document.documentElement.dataset.theme = value;
    // 关键：同步切换两套样式表的启用状态，否则主题不会真正生效
    const green = document.getElementById("theme-green");
    const ios = document.getElementById("theme-ios");
    if (green && green.disabled !== undefined) green.disabled = value === "ios";
    if (ios && ios.disabled !== undefined) ios.disabled = value !== "ios";
    document.querySelectorAll(".theme-toggle").forEach(button => {
      button.innerHTML = icon("palette");
      button.setAttribute("aria-label", `当前主题：${THEME_NAMES[value]}，点击切换`);
      button.title = `换肤 · 当前：${THEME_NAMES[value]}`;
    });
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "ios" ? "green" : "ios";
    applyTheme(next);
    try {
      Store.updateSettings({ theme: next });
    } catch (error) {
      toast(error.message, true);
    }
    toast(`已切换到${THEME_NAMES[next]}主题。`);
  }

  /* ------------------------- 弹层与表单 ------------------------- */
  function openModal(content) {
    ui.lastFocus = document.activeElement;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal-sheet" role="dialog" aria-modal="true"><div class="sheet-handle"></div>${content}</section></div>`;
    document.body.style.overflow = "hidden";
    setTimeout(() => {
      const focusable = modalRoot.querySelector("input:not([type=hidden]), textarea, button");
      if (focusable) focusable.focus({ preventScroll: true });
    }, 100);
  }

  function closeModal() {
    modalRoot.innerHTML = "";
    document.body.style.overflow = "";
    if (ui.lastFocus && document.contains(ui.lastFocus)) ui.lastFocus.focus({ preventScroll: true });
  }

  function sheetHeader(title) {
    return `<div class="sheet-header"><h2>${e(title)}</h2><button class="close-button" type="button" data-action="close-modal" aria-label="关闭">×</button></div>`;
  }

  function openWord(id) {
    const word = Store.getWord(id);
    if (!word) return;
    const allWords = Store.getState().words;
    const synonymChips = (word.synonyms || []).map(synonym => {
      const target = Data.findByWord(synonym, allWords);
      return target
        ? `<button class="syn-chip" type="button" data-action="open-synonym" data-id="${e(target.id)}" title="查看 ${e(target.word)}">${e(target.word)}</button>`
        : `<span class="syn-chip syn-chip-plain">${e(synonym)}</span>`;
    }).join("");
    const contexts = word.contexts && word.contexts.length ? word.contexts : [{ text: word.example, cn: word.exampleCn }];
    const contextList = contexts.filter(c => c.text).map((context, index) => `<div class="ctx-sentence">${highlightContext(context.text, word)}${context.cn ? `<p class="ctx-cn">${e(context.cn)}</p>` : ""}</div>`).join("") || '<p class="muted">暂无语境例句</p>';
    const isInput = word.level === "passive";
    const lineStatus = isInput
      ? `输入线（被动词汇） · 语境接触 ${(word.exposures || 0)} 次（解锁需 ${Store.UNLOCK_EXPOSURES}） · 已见语境 ${((word.seenContexts || []).length)} 条<br><span class="muted">解锁条件：接触 ≥${Store.UNLOCK_EXPOSURES} · 连对 ≥${Store.UNLOCK_STREAK} · 掌握分 ≥${Store.UNLOCK_MASTERY}（当前 ${word.mastery}）</span>`
      : `产出线（主动词汇） · 阶梯进度 L${Math.max(1, Math.min(4, word.conversionStep || 1))}/4${(word.prodFails || 0) ? ` · 历史回炉 ${(word.prodFails || 0)} 次` : ""}`;
    const unlockButton = isInput
      ? (word.mastery >= Store.UNLOCK_MASTERY
        ? `<button class="primary-button" type="button" data-action="unlock-word" data-id="${e(word.id)}">解锁主动线</button>`
        : `<button class="secondary-button" type="button" disabled title="掌握分达到 60 后可手动解锁">掌握分 ${word.mastery}/60 · 暂不可解锁</button>`)
      : `<button class="primary-button" type="button" data-action="train-single" data-id="${e(word.id)}">训练此词</button>`;
    openModal(`${sheetHeader("词汇详情")}
      <div class="word-detail-head"><div class="word-row-top"><div><h3>${e(word.word)}</h3><p class="review-phonetic">${e(word.phonetic)} · ${e(word.pos)}</p></div><button class="icon-button soft" type="button" data-action="speak-word" data-word="${e(word.word)}" aria-label="朗读">${icon("volume")}</button></div><div class="word-row-meta">${levelPill(word.level)}<span class="pill">${e(word.exam)}</span><span class="pill">${e(word.difficulty)}</span>${word.wrong ? '<span class="pill wrong">错题</span>' : ""}</div></div>
      <div class="detail-block"><h4>核心释义</h4><p>${e(word.meaning)}</p></div>
      <div class="detail-block"><h4>高频搭配</h4><div class="collocation-list">${word.collocations.length ? word.collocations.map(item => `<span>${e(item)}</span>`).join("") : '<p class="muted">暂无搭配</p>'}</div></div>
      <div class="detail-block"><h4>语境例句（输入线复现材料）</h4>${contextList}</div>
      <div class="detail-block"><h4>同近义词</h4><div class="collocation-list">${synonymChips || '<p class="muted">暂无同近义词</p>'}</div><p class="caption" style="margin-top:7px">点击同义词可跳转到对应单词详情（灰色为词库外词汇）。</p></div>
      <div class="detail-block"><h4>个人易错备注</h4><p>${e(word.note || "暂无备注")}</p></div>
      <div class="detail-block"><h4>双线学习状态</h4><p>${lineStatus}<br>掌握评分 ${word.mastery}% · 答对 ${word.correctCount} 次 · 答错 ${word.wrongCount} 次<br><span class="muted">下次复习：${SRS.dueLabel(word)}</span></p></div>
      <div class="form-actions"><button class="secondary-button" type="button" data-action="edit-word" data-id="${e(word.id)}">编辑</button>${unlockButton}</div>`);
  }

  function openWordForm(id) {
    const word = id ? Store.getWord(id) : null;
    const value = (key, fallback) => e(word ? word[key] : (fallback || ""));
    openModal(`${sheetHeader(word ? "编辑词汇" : "新增词汇")}
      <form id="word-form" data-id="${e(id || "")}">
        <div class="form-grid">
          <div class="field full"><label for="word">单词 *</label><input id="word" name="word" value="${value("word")}" autocapitalize="off" required></div>
          <div class="field"><label for="phonetic">音标</label><input id="phonetic" name="phonetic" value="${value("phonetic")}" placeholder="/ˈæpəl/"></div>
          <div class="field"><label for="pos">词性</label><input id="pos" name="pos" value="${value("pos")}" placeholder="v. / n. / adj."></div>
          <div class="field full"><label for="meaning">核心释义 *</label><input id="meaning" name="meaning" value="${value("meaning")}" required></div>
          <div class="field"><label for="level">所属线路</label><select id="level" name="level">${["passive", "active"].map(level => `<option value="${level}" ${(word ? word.level : "passive") === level ? "selected" : ""}>${LEVEL_NAMES[level]}（${level === "passive" ? "被动识别" : "主动产出"}）</option>`).join("")}</select></div>
          <div class="field"><label for="difficulty">难度标签</label><select id="difficulty" name="difficulty">${Data.DIFFICULTIES.map(item => `<option ${(word ? word.difficulty : "中等") === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="field"><label for="exam">词库分类</label><select id="exam" name="exam">${["CET4", "CET6", "custom"].map(item => `<option ${(word ? word.exam : "custom") === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="field full"><label for="collocations">高频搭配</label><textarea id="collocations" name="collocations" placeholder="用分号分隔，如 make a plan;plan ahead">${e(word ? word.collocations.join(";") : "")}</textarea></div>
          <div class="field full"><label for="example">英文例句</label><textarea id="example" name="example">${value("example")}</textarea></div>
          <div class="field full"><label for="exampleCn">例句译文</label><textarea id="exampleCn" name="exampleCn">${value("exampleCn")}</textarea></div>
          <div class="field full"><label for="note">个人易错备注</label><textarea id="note" name="note" placeholder="记录拼写、搭配或语境上的易错点">${value("note")}</textarea></div>
        </div>
        <div class="form-actions">${word ? '<button class="danger-button" type="button" data-action="confirm-delete" data-id="' + e(word.id) + '">删除</button>' : ""}<button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存</button></div>
      </form>`);
  }

  function openImport() {
    openModal(`${sheetHeader("批量导入词汇")}
      <div class="import-help">每行一个词，使用“|”分隔：<br>单词 | 音标 | 词性 | 释义 | 搭配(用分号分隔) | 英文例句 | 例句译文 | 难度 | 分类<br>也可直接粘贴词汇 JSON 数组；重复单词会自动跳过。只想快速加词？去词库页使用「快速添加」。</div>
      <form id="import-form"><textarea class="import-textarea" name="content" placeholder="ability | /əˈbɪləti/ | n. | 能力 | have the ability to | This ability improves with practice. | 这种能力会随练习提高。 | 中等 | custom" required></textarea><div class="button-row" style="margin-top:10px"><button class="secondary-button" type="button" data-action="fill-template">填入示例</button><button class="primary-button" type="submit">开始导入</button></div></form>`);
  }

  function openQuickAdd() {
    openModal(`${sheetHeader("快速添加词汇")}
      <div class="import-help">每行一个词条：<strong>单词 | 中文释义</strong>（释义必填），一次可粘贴任意多行。已在词库中的单词自动跳过。加入输入线的词需在语境中积累识别；加入产出线的词会直接进入阶梯一。</div>
      <form id="quick-add-form">
        <div class="field"><label for="quick-level">添加到</label><select id="quick-level" name="level">
          <option value="passive">输入线 · 被动词汇（推荐）</option>
          <option value="active">产出线 · 主动词汇</option>
        </select></div>
        <textarea class="import-textarea" style="min-height:170px" name="content" placeholder="serendipity | 意外发现的乐趣
bucket list | 人生愿望清单
closure | 闭包；关闭" required></textarea>
        <div class="form-actions"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">批量添加</button></div>
      </form>`);
  }

  function exitBatchMode() {
    ui.batchMode = false;
    ui.selected.clear();
    render(true);
  }

  function runBatchAction(kind) {
    if (!ui.selected.size) return toast("请先勾选词汇。", true);
    const ids = [...ui.selected];
    let skipped = 0;
    const count = Store.batchUpdate(ids, word => {
      if (kind === "unlock") {
        if (word.level === "active") { skipped += 1; return; }
        if ((word.mastery || 0) < Store.UNLOCK_MASTERY) { skipped += 1; return; }
        word.level = "active";
        word.unlocked = true;
        word.conversionStep = 0;
        word.nextReviewAt = new Date().toISOString();
      } else if (kind === "passive") {
        if (word.level !== "passive") {
          word.level = "passive";
          word.unlocked = false;
          word.conversionStep = 0;
          word.mastery = Math.min(word.mastery, 45);
        }
      } else if (kind === "clearwrong") {
        word.wrong = false;
        word.consecutiveWrong = 0;
      }
    });
    const messages = {
      unlock: `${count} 词已解锁进入主动线${skipped ? `（${skipped} 词掌握分不足 60 已跳过）` : ""}。`,
      passive: `${count} 词已移回输入线。`,
      clearwrong: `${count} 词已移出错题本。`
    };
    ui.selected.clear();
    render(true);
    toast(messages[kind], kind === "unlock" && !count);
  }

  function runBatchDelete() {
    const ids = [...ui.selected];
    const targets = ids.map(id => Store.getWord(id)).filter(word => word && !word.isBuiltin);
    if (!targets.length) return toast("选中项没有个人词汇（内置词不可删除）。", true);
    confirmAction("删除选中的个人词汇？", `将删除 ${targets.length} 条个人词汇，内置词不受影响，且不可恢复。`, "batch-confirm-delete");
  }

  function openStudySettings() {
    const settings = Store.getState().settings;
    openModal(`${sheetHeader("学习目标与发音")}<form id="study-settings-form"><div class="field"><label for="dailyGoal">每日复习目标（次）</label><input id="dailyGoal" name="dailyGoal" type="number" min="5" max="200" step="5" value="${settings.dailyGoal}" required><small>同时决定单轮复习的卡片上限。</small></div><div class="field"><label for="ttsRate">TTS 发音语速</label><select id="ttsRate" name="ttsRate">${[0.7, 0.8, 0.9, 1, 1.1].map(rate => `<option value="${rate}" ${Number(settings.ttsRate) === rate ? "selected" : ""}>${rate}x${rate === 0.9 ? "（推荐）" : ""}</option>`).join("")}</select></div><div class="form-actions"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存设置</button></div></form>`);
  }

  function openAISettings() {
    const ai = Store.getState().settings.ai;
    openModal(`${sheetHeader("AI 拓展配置")}<div class="ai-note" style="margin-bottom:16px">兼容 OpenAI Chat Completions 格式。接口地址可填写服务根地址或完整的 /chat/completions 地址。留空即保持离线。</div><form id="ai-form"><div class="field"><label for="endpoint">API Endpoint</label><input id="endpoint" name="endpoint" type="url" value="${e(ai.endpoint)}" placeholder="https://your-api.example/v1"></div><div class="field"><label for="apiKey">API Key</label><input id="apiKey" name="apiKey" type="password" value="${e(ai.apiKey)}" autocomplete="off" placeholder="仅保存到当前浏览器"></div><div class="field"><label for="model">模型名称</label><input id="model" name="model" value="${e(ai.model)}" placeholder="gpt-4o-mini"></div><div class="form-actions"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存配置</button></div></form>`);
  }

  function confirmAction(title, text, action, id) {
    openModal(`${sheetHeader(title)}<p class="confirm-copy">${e(text)}</p><div class="button-row"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="danger-button" type="button" data-action="${action}" data-id="${e(id || "")}">确认</button></div>`);
  }

  /* ------------------------- TTS 与 AI ------------------------- */
  function speak(text, button) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      toast("当前浏览器不支持 TTS，请使用新版 Safari、Chrome 或 Edge。", true);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text || "").trim());
    utterance.lang = "en-US";
    utterance.rate = Number(Store.getState().settings.ttsRate) || 0.9;
    if (button) {
      button.classList.add("speaking");
      utterance.onend = utterance.onerror = () => button.classList.remove("speaking");
    }
    window.speechSynthesis.speak(utterance);
  }

  async function reviewSentenceWithAI(button) {
    const word = currentWord();
    const sentence = ui.session.sentenceAnswer || ui.session.userAnswer;
    if (!sentence) return toast("未找到可批改的句子。", true);
    button.disabled = true;
    button.textContent = "AI 正在批改…";
    try {
      const result = await AI.reviewSentence(word, sentence);
      openModal(`${sheetHeader("AI 造句反馈")}<div class="word-detail-head"><strong>${e(word.word)}</strong><p style="margin-top:8px">${e(sentence)}</p></div><div class="detail-block"><h4>批改建议</h4><p style="white-space:pre-wrap">${e(result)}</p></div><div class="form-actions"><button class="primary-button" type="button" data-action="close-modal">知道了</button></div>`);
    } catch (error) {
      toast(error.name === "AbortError" ? "AI 请求超时，请稍后重试。" : error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "使用 AI 批改造句（需配置）";
    }
  }

  /* ------------------------- 事件委托 ------------------------- */
  document.addEventListener("click", event => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) {
      navigate(routeButton.dataset.route);
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;

    if (action === "backdrop-close") {
      if (event.target === button) closeModal();
      return;
    }
    if (action === "close-modal") closeModal();
    else if (action === "add-word") openWordForm();
    else if (action === "open-word") openWord(button.dataset.id);
    else if (action === "open-synonym") {
      const target = Store.getWord(button.dataset.id);
      if (target) openWord(target.id);
      else toast("该词不在当前词库中。", true);
    }
    else if (action === "toggle-theme") toggleTheme();
    else if (action === "edit-word") openWordForm(button.dataset.id);
    else if (action === "confirm-delete") confirmAction("删除这条词汇？", "删除后不可恢复，相关统计日志会保留词汇名称。", "delete-word", button.dataset.id);
    else if (action === "delete-word") {
      Store.removeWord(button.dataset.id); closeModal(); render(); toast("词汇已删除。 ");
    }
    else if (action === "unlock-word") {
      try {
        const word = Store.unlockWord(button.dataset.id);
        closeModal(); ui.libraryTab = "active"; render();
        toast(`${word.word} 已解锁主动线，从阶梯一开始。`);
      } catch (error) {
        toast(error.message, true);
      }
    }
    else if (action === "train-single") {
      const id = button.dataset.id;
      const word = Store.getWord(id);
      closeModal();
      ui.librarySet = new Set(Store.getState().words.map(item => item.word.toLowerCase()));
      ui.session = { mode: word && word.level === "active" ? "active" : "passive", queue: [id], index: 0, phase: "question", question: null, selected: null, userAnswer: "", correct: null, answeredIds: [], results: { correct: 0, wrong: 0, skipped: 0 }, completed: false };
      ui.route = "review"; render();
    }
    else if (action === "library-tab") { ui.libraryTab = button.dataset.level; ui.libraryLimit = 30; ui.selected.clear(); render(true); }
    else if (action === "filter") { ui.filters[button.dataset.key] = button.dataset.value; ui.libraryLimit = 30; ui.selected.clear(); render(true); }
    else if (action === "clear-search") { ui.filters.search = ""; ui.selected.clear(); render(true); }
    else if (action === "show-more") { ui.libraryLimit += 30; render(true); }
    else if (action === "toggle-batch") { ui.batchMode = !ui.batchMode; ui.selected.clear(); render(true); }
    else if (action === "toggle-select") {
      const id = button.dataset.id;
      if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
      render(true);
    }
    else if (action === "batch-select-all") {
      const filtered = getFilteredWords();
      const allSelected = filtered.length > 0 && filtered.every(word => ui.selected.has(word.id));
      if (allSelected) ui.selected.clear();
      else filtered.forEach(word => ui.selected.add(word.id));
      render(true);
    }
    else if (action === "batch-unlock") runBatchAction("unlock");
    else if (action === "batch-passive") runBatchAction("passive");
    else if (action === "batch-clearwrong") runBatchAction("clearwrong");
    else if (action === "batch-delete") runBatchDelete();
    else if (action === "batch-confirm-delete") {
      let removed = 0;
      ui.selected.forEach(id => {
        const word = Store.getWord(id);
        if (word && !word.isBuiltin) { Store.removeWord(id); removed += 1; }
      });
      closeModal();
      exitBatchMode();
      toast(`已删除 ${removed} 条个人词汇。`);
    }
    else if (action === "quick-add") openQuickAdd();
    else if (action === "start-session") startSession(button.dataset.mode);
    else if (action === "end-session") { ui.session = null; ui.route = "review"; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (action === "select-option") selectOption(button.dataset.index);
    else if (action === "rate-answer") rateAnswer(Number(button.dataset.rating));
    else if (action === "skip-card") animateCard("left", () => nextCard(true));
    else if (action === "speak-current") { const word = currentWord(); if (word) speak(word.word, button); }
    else if (action === "speak-word") speak(button.dataset.word, button);
    else if (action === "import-words") openImport();
    else if (action === "fill-template") { const textarea = modalRoot.querySelector("textarea"); textarea.value = Data.IMPORT_TEMPLATE; textarea.focus(); }
    else if (action === "export-data") exportBackup();
    else if (action === "import-backup") openImportBackup();
    else if (action === "study-settings") openStudySettings();
    else if (action === "ai-settings") openAISettings();
    else if (action === "ai-review") reviewSentenceWithAI(button);
    else if (action === "reset-data") confirmAction("恢复初始词库？", "此操作会清除所有个人词汇、学习日志和设置，且不可撤销。建议先导出备份。", "confirm-reset");
    else if (action === "confirm-reset") { Store.reset(); ui.session = null; closeModal(); render(); toast("已恢复初始四六级词库。 "); }
  });

  document.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    try {
      if (form.id === "answer-form") submitAnswer(data.get("answer"), data.get("sentence"));
      else if (form.id === "word-form") {
        const input = Object.fromEntries(data.entries());
        if (form.dataset.id) Store.updateWord(form.dataset.id, input);
        else Store.addWord(input);
        closeModal(); render(); toast(form.dataset.id ? "词汇已更新。 " : "新词汇已加入词库。 ");
      } else if (form.id === "import-form") {
        const result = Store.parseImport(data.get("content"));
        closeModal(); render();
        toast(`成功导入 ${result.added} 条，跳过 ${result.skipped} 条${result.errors.length ? `，${result.errors.length} 条有误` : ""}。`, Boolean(result.errors.length));
        if (result.errors.length) console.warn(result.errors.join("\n"));
      } else if (form.id === "quick-add-form") {
        const result = Store.quickAdd(data.get("content"), data.get("level"));
        closeModal(); render();
        toast(`成功添加 ${result.added} 条${result.skipped ? `，跳过已在词库的 ${result.skipped} 条` : ""}${result.errors.length ? `，${result.errors.length} 行有误` : ""}。`, Boolean(result.errors.length || !result.added));
        if (result.errors.length) console.warn(result.errors.join("\n"));
      } else if (form.id === "study-settings-form") {
        Store.updateSettings({ dailyGoal: Math.max(5, Math.min(200, Number(data.get("dailyGoal")) || 20)), ttsRate: Number(data.get("ttsRate")) || 0.9 });
        closeModal(); render(); toast("学习偏好已保存。 ");
      } else if (form.id === "ai-form") {
        Store.updateSettings({ ai: { endpoint: String(data.get("endpoint") || "").trim(), apiKey: String(data.get("apiKey") || "").trim(), model: String(data.get("model") || "").trim() || "gpt-4o-mini" } });
        closeModal(); render(); toast("AI 配置已保存在本机。 ");
      }
    } catch (error) {
      toast(error.message || "操作失败，请重试。", true);
    }
  });

  let searchTimer;
  document.addEventListener("input", event => {
    if (event.target.id !== "library-search") return;
    clearTimeout(searchTimer);
    const value = event.target.value;
    searchTimer = setTimeout(() => {
      ui.filters.search = value;
      ui.libraryLimit = 30;
      render(true);
      const search = document.getElementById("library-search");
      if (search) { search.focus(); search.setSelectionRange(value.length, value.length); }
    }, 180);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modalRoot.innerHTML) closeModal();
  });

  // 触控手势：左右/上下轻滑切换；已评分卡片需先选择掌握程度。
  main.addEventListener("touchstart", event => {
    if (!event.target.closest("#review-stage") || !ui.session || ui.session.completed) return;
    const touch = event.changedTouches[0];
    ui.touch = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });

  main.addEventListener("touchend", event => {
    if (!ui.touch || !ui.session) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - ui.touch.x;
    const dy = touch.clientY - ui.touch.y;
    ui.touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 48) return;
    if (ui.session.phase === "feedback") return toast("请先完成本题反馈，再切换卡片。 ");
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) animateCard("left", () => nextCard(true));
      else animateCard("right", previousCard);
    } else {
      if (dy < 0) animateCard("up", () => nextCard(true));
      else animateCard("right", previousCard);
    }
  }, { passive: true });

  function exportBackup() {
    const blob = new Blob([Store.exportData()], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lexicon-flow-backup-${Store.dayKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("备份文件已生成。 ");
  }

  /** 导入完整备份：选择 JSON 文件 → 恢复进度、个人词汇、日志与设置。 */
  function openImportBackup() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          Store.importBackup(String(reader.result));
          ui.session = null;
          ui.librarySet = null;
          applyTheme(Store.getState().settings.theme || DEFAULT_THEME);
          render();
          toast("备份已导入，学习进度已恢复。 ");
        } catch (error) {
          toast(error.message || "备份导入失败，请确认选择了正确的备份文件。", true);
        }
      };
      reader.onerror = () => toast("读取文件失败，请重试。", true);
      reader.readAsText(file, "utf-8");
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  // 启动：加载本地数据、应用主题并渲染首屏。
  Store.load();
  applyTheme(Store.getState().settings.theme || DEFAULT_THEME);
  render();
})();
