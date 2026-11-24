/* jsdom 端到端测试（v3 双线训练模型）：
   词库加载、v1 迁移（candidate→active）、主题切换、同义词跳转、
   语境材料、输入线解锁门槛、产出线阶梯与回炉、正误 UI 反馈 */
const fs = require("fs");
const path = require("path");
// jsdom 解析顺序：项目本地安装 → JSDOM_PATH 环境变量指向的 node_modules 目录
let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch (error) {
  try {
    ({ JSDOM } = require(path.join(process.env.JSDOM_PATH || "", "jsdom")));
  } catch (inner) {
    console.error("未找到 jsdom：请在项目目录安装 jsdom，或设置 JSDOM_PATH 指向包含 jsdom 的 node_modules 目录。");
    process.exit(1);
  }
}

const appDir = process.argv[2] || process.cwd();
let html = fs.readFileSync(path.join(appDir, "standalone.html"), "utf8");

// 预置 v1 旧数据（在首部脚本之前执行）
const preseed = `<script>
localStorage.setItem('lexicon-flow:v1', JSON.stringify({ version:1, words:[
  {id:'o1', word:'abruptly', isBuiltin:true, level:'candidate', mastery:72, streak:2, wrong:false, wrongCount:1, correctCount:5, nextReviewAt:'2020-01-01T00:00:00.000Z'},
  {id:'o2', word:'myoldword', isBuiltin:false, word:'myoldword', meaning:'我的旧词', level:'active'}
], logs:[], settings:{ dailyGoal:33 }}));
</script>`;
html = html.replace('<div class="app-shell"', preseed + '<div class="app-shell"');

const dom = new JSDOM(html, {
  url: "http://localhost/app",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.__errs = [];
    window.onerror = (m) => { window.__errs.push(String(m)); return true; };
  }
});

const { window } = dom;
const doc = window.document;
const out = [];

function step(name, fn) {
  try { out.push(name + "=" + fn()); }
  catch (e) { out.push(name + "=ERR:" + e.message); }
}
const Store = () => window.VocabStore;
const words = () => Store().getState().words;
const click = sel => { const el = doc.querySelector(sel); if (!el) throw new Error("no el " + sel); el.click(); return el; };

step("WORDS", () => words().length);
step("ERR_BOOT", () => window.__errs.join(";"));

// v1 迁移：candidate → active
step("MIGRATE_LEVEL", () => {
  const w = words().find(x => x.word === "abruptly");
  return w ? w.level + "/" + w.mastery + "/unlocked:" + w.unlocked : "MISSING";
});
step("MIGRATE_USER", () => words().some(x => x.word === "myoldword") ? "OK" : "FAIL");
step("MIGRATE_GOAL", () => Store().getState().settings.dailyGoal);

// 主题
step("T0", () => doc.documentElement.getAttribute("data-theme"));
step("CSS0", () => {
  const ios = doc.getElementById("theme-ios");
  return ios && ios.sheet ? (ios.disabled ? "ios-off" : "ios-on") : "nosheet";
});
doc.getElementById("theme-toggle").click();
step("T1", () => doc.documentElement.getAttribute("data-theme"));
step("CSS1", () => {
  const ios = doc.getElementById("theme-ios");
  const green = doc.getElementById("theme-green");
  return "ios:" + (ios && ios.disabled ? "off" : "on") + " green:" + (green && green.disabled ? "off" : "on");
});
doc.getElementById("theme-toggle").click();
step("T2", () => doc.documentElement.getAttribute("data-theme"));
step("SAVED_THEME", () => JSON.parse(window.localStorage.getItem("lexicon-flow:v2")).settings.theme);

// 同义词跳转（abruptly 已迁移为产出线词，切到 active tab）
doc.querySelector('[data-route="library"]').click();
click('[data-action="library-tab"][data-level="active"]');
const synRow = [...doc.querySelectorAll(".word-row")].find(r => r.textContent.includes("abruptly"));
if (synRow) {
  synRow.click();
  step("SYNCHIPS", () => doc.querySelectorAll("#modal-root .syn-chip").length);
  const clickable = doc.querySelector('#modal-root .syn-chip[data-action="open-synonym"]');
  const before = doc.querySelector("#modal-root .word-detail-head h3").textContent;
  clickable.click();
  const after = doc.querySelector("#modal-root .word-detail-head h3").textContent;
  step("SYNJUMP", () => before + "->" + after);
} else {
  step("SYNCHIPS", () => "ROW_NOT_FOUND");
}

// 例句、释义与多语境抽检
step("SAMPLE", () => {
  const w = words().find(x => x.word === "benefit");
  return JSON.stringify({ pos: w.pos, meaning: w.meaning.slice(0, 12), coll: w.collocations.length, ex: Boolean(w.example), exc: Boolean(w.exampleCn), syn: w.synonyms.length, ctx: (w.contexts || []).length });
});

/* ---- 产出线 UI：L1 首字母填空 + 答错回炉 ---- */
const closeBtn = doc.querySelector('[data-action="close-modal"]');
if (closeBtn) closeBtn.click();
doc.querySelector('[data-route="review"]').click();
click('[data-action="start-session"][data-mode="active"]');
step("L1_UI", () => {
  const hint = doc.querySelector("#review-card .hint-letters");
  const dots = doc.querySelectorAll(".stepper .step-dot").length;
  return hint ? "hint=" + hint.textContent.trim() + " dots=" + dots : "NO_HINT";
});
// 故意答错 → 词框变红 + 下方出现正确答案词框
const l1Input = doc.querySelector("#answer-form .answer-input");
l1Input.value = "zzzzzz";
doc.getElementById("answer-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
step("WRONG_RED", () => {
  const card = doc.getElementById("review-card");
  return "class:" + (card.className.includes("wrong-answer") ? "red" : card.className) + " answerCard:" + Boolean(doc.querySelector(".answer-card"));
});
step("ANSWER_CARD_TEXT", () => {
  const head = doc.querySelector(".answer-card .answer-card-head");
  return head ? head.textContent.replace(/\s+/g, " ").trim().slice(0, 40) : "NONE";
});
// 点击“回炉继续”
click('[data-action="rate-answer"][data-rating="0"]');
step("RECYCLED", () => {
  const w = words().find(x => x.word === "myoldword");
  return w ? "level:" + w.level + " prodFails:" + w.prodFails + " unlocked:" + w.unlocked : "MISSING";
});

/* ---- 输入线批量解锁门槛（掌握分不足 → 全部跳过） ---- */
doc.querySelector('[data-route="library"]').click();
click('[data-action="library-tab"][data-level="passive"]');
click('[data-action="toggle-batch"]');
for (let i = 0; i < 2; i++) {
  const liveRows = [...doc.querySelectorAll(".word-row:not(.row-selected)")];
  if (liveRows[i]) liveRows[i].click();
}
step("SELECTED", () => doc.querySelectorAll(".word-row.row-selected").length);
click('[data-action="batch-unlock"]');
step("BATCH_UNLOCK_GATE", () => {
  const activeCount = words().filter(w => w.level === "active").length;
  return "active-total=" + activeCount + " (期望 0，掌握分不足全部跳过)";
});
click('[data-action="toggle-batch"]');

/* ---- 快速添加：3 行 → 产出线 ---- */
click('[data-action="quick-add"]');
const ta = doc.querySelector("#quick-add-form textarea");
ta.value = "jsdom word alpha | 测试词甲\njsdom word beta | 测试词乙\nabandon | 放弃";
doc.getElementById("quick-level").value = "active";
doc.getElementById("quick-add-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
step("QUICKADD", () => {
  const s = words();
  const alpha = s.find(w => w.word === "jsdom word alpha");
  return "active-total=" + s.filter(w => w.level === "active").length +
    " alpha=" + (alpha ? alpha.level + "/" + alpha.meaning : "missing");
});

/* ---- 输入线解锁门槛（Store 级）：3 次语境接触 + 连对 + 掌握分 → 解锁 ---- */
step("UNLOCK_GATE", () => {
  const store = Store();
  const target = words().find(w => w.word === "abandon");
  const id = target.id;
  let events = [];
  for (let i = 0; i < 3; i++) {
    const r = store.recordAttempt(id, { correct: true, rating: 4, line: "passive", contextIndex: i });
    events = r.events;
  }
  const w = words().find(x => x.id === id);
  return JSON.stringify({ exposures: w.exposures, streak: w.streak, mastery: w.mastery, level: w.level, unlocked: w.unlocked, lastEvent: events.map(x => x.type).join(",") });
});

/* ---- 产出线阶梯（Store 级）：L1 通过 → 回炉 ---- */
step("LADDER_RECYCLE", () => {
  const store = Store();
  const id = words().find(w => w.word === "abandon").id;
  const pass = store.recordAttempt(id, { correct: true, rating: 3, line: "active", stepPass: true });
  const fail = store.recordAttempt(id, { correct: false, rating: 0, line: "active" });
  const w = words().find(x => x.id === id);
  return JSON.stringify({ afterPass: pass.word.conversionStep, afterFail: { level: w.level, step: w.conversionStep, prodFails: w.prodFails, mastery: w.mastery }, failEvents: fail.events.map(x => x.type).join(",") });
});

/* ---- 输入线 UI：语境材料 + 正确变绿 / 错误变红+答案框 ---- */
doc.querySelector('[data-route="review"]').click();
const endBtn = doc.querySelector('[data-action="end-session"]');
if (endBtn) endBtn.click(); // 上一轮会话若停留在完成页，先退出
click('[data-action="start-session"][data-mode="passive"]');
let greenSeen = false, redSeen = false, answerSeen = false, ctxMetaSeen = false, coverageText = "";
for (let i = 0; i < 3; i++) {
  const mark = doc.querySelector("#review-card .ctx-mark");
  const optionButtons = [...doc.querySelectorAll("#review-card .option-button")];
  if (mark) {
    ctxMetaSeen = Boolean(doc.querySelector("#review-card .ctx-meta .badge"));
    const cov = [...doc.querySelectorAll("#review-card .ctx-meta .badge")].map(b => b.textContent).find(t => t.includes("覆盖"));
    if (cov) coverageText = cov.trim();
    const wordText = mark.textContent.trim().toLowerCase();
    const word = words().find(w => w.word.toLowerCase() === wordText);
    if (word) {
      let opt = null;
      if (doc.querySelector("#review-card .answer-reveal")) {
        // 语境判断：proposedMeaning 与真实释义比对
        const proposed = doc.querySelector("#review-card .answer-reveal strong").textContent.trim();
        opt = optionButtons.find(b => b.textContent.trim() === (proposed === word.meaning ? "释义匹配" : "释义不匹配"));
      } else {
        opt = optionButtons.find(b => b.textContent.trim() === word.meaning);
      }
      if (opt) opt.click();
    } else if (optionButtons[0]) optionButtons[0].click();
  } else if (optionButtons[0]) {
    optionButtons[0].click();
  }
  const card = doc.getElementById("review-card");
  if (card) {
    if (card.className.includes("correct")) greenSeen = true;
    if (card.className.includes("wrong-answer")) redSeen = true;
  }
  if (doc.querySelector(".answer-card")) answerSeen = true;
  // 完成本题：优先点正确后的评分 4，否则点“继续”
  const rateBtn = doc.querySelector('[data-action="rate-answer"][data-rating="4"]') || doc.querySelector('[data-action="rate-answer"][data-rating="0"]');
  if (rateBtn) rateBtn.click(); else break;
}
step("INPUT_UI", () => JSON.stringify({ green: greenSeen, red: redSeen, answerCard: answerSeen, ctxMeta: ctxMetaSeen, coverage: coverageText }));

/* ---- 不知道选项：记为答错、显示正确答案、可正常评分 ---- */
step("DONT_KNOW", () => {
  doc.querySelector('[data-route="review"]').click();
  const endBtn2 = doc.querySelector('[data-action="end-session"]');
  if (endBtn2) endBtn2.click();
  click('[data-action="start-session"][data-mode="passive"]');
  const btn = doc.querySelector('[data-action="dont-know"]');
  if (!btn) throw new Error("dont-know 按钮未渲染");
  btn.click();
  const card = doc.getElementById("review-card");
  const banner = doc.querySelector(".feedback-banner");
  const title = banner && banner.querySelector("strong") ? banner.querySelector("strong").textContent : "";
  const wrongClass = Boolean(card && card.className.includes("wrong-answer"));
  const answerShown = Boolean(banner && banner.textContent.includes("正确答案"));
  click('[data-action="rate-answer"][data-rating="0"]');
  const advanced = doc.querySelector('[data-action="dont-know"]') !== null && doc.getElementById("review-card");
  return JSON.stringify({ title, wrongClass, answerShown, advanced: Boolean(advanced) });
});

/* ---- 导入备份 / 恢复进度（Store 级）：导出 → 重置 → 导入 → 进度恢复 ---- */
step("IMPORT_BACKUP", () => {
  const store = Store();
  const exported = store.exportData();
  const target = words().find(w => w.word === "abandon");
  const before = { mastery: target.mastery, level: target.level, exposures: target.exposures };
  const goalBefore = store.getState().settings.dailyGoal;
  store.reset();
  const afterReset = words().find(w => w.word === "abandon").mastery;
  store.importBackup(exported);
  const restored = words().find(w => w.word === "abandon");
  const goalRestored = store.getState().settings.dailyGoal;
  return JSON.stringify({
    before: before.mastery,
    afterReset,
    restored: restored.mastery,
    restoredLevel: restored.level,
    restoredExposures: restored.exposures,
    goal: goalBefore + "->" + goalRestored
  });
});
step("ERRS_FINAL", () => window.__errs.join(";") || "(none)");

console.log(out.join("\n"));
console.log("ERRORS:", window.__errs.join(";") || "(none)");
