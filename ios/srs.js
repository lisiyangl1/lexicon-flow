/* =========================================================
   简易间隔重复（SRS）模块
   rating：0 完全不会 / 1 有点印象 / 2 基本掌握 / 3 熟练 / 4 非常熟练
   纯函数设计：不直接修改原词汇，便于测试与二次扩展。
   ========================================================= */
(function () {
  "use strict";

  const RATINGS = [
    { value: 0, label: "完全不会", interval: "当日重测", days: 0 },
    { value: 1, label: "有点印象", interval: "1 天后", days: 1 },
    { value: 2, label: "基本掌握", interval: "3 天后", days: 3 },
    { value: 3, label: "熟练", interval: "7 天后", days: 7 },
    { value: 4, label: "非常熟练", interval: "15–30 天后", days: 15 }
  ];

  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function isDue(word, at) {
    if (!word.nextReviewAt) return true;
    return new Date(word.nextReviewAt).getTime() <= (at || Date.now());
  }

  function apply(word, rating, at) {
    const value = Math.max(0, Math.min(4, Number(rating) || 0));
    const now = at ? new Date(at) : new Date();
    const next = Object.assign({}, word);
    const previousMastery = Number(word.mastery) || 0;
    const nextStreak = value >= 2 ? (Number(word.streak) || 0) + 1 : 0;
    let days = RATINGS[value].days;
    let nextDate;

    if (value === 0) {
      // 十分钟后再次到期，保证仍是“当日重测”，也避免当前队列死循环。
      nextDate = new Date(now.getTime() + 10 * 60 * 1000);
      next.mastery = Math.max(0, Math.round(previousMastery * 0.4));
    } else {
      if (value === 4 && nextStreak >= 3) days = 30;
      nextDate = addDays(now, days);
      const target = [0, 25, 50, 75, 92][value];
      next.mastery = Math.min(100, Math.round(previousMastery * 0.35 + target * 0.65 + Math.min(nextStreak, 4)));
    }

    next.lastReviewedAt = now.toISOString();
    next.nextReviewAt = nextDate.toISOString();
    next.streak = nextStreak;
    next.updatedAt = now.toISOString();
    return next;
  }

  function dueLabel(word) {
    if (!word.nextReviewAt) return "尚未安排";
    const diff = new Date(word.nextReviewAt).getTime() - Date.now();
    if (diff <= 0) return "现在复习";
    const hours = Math.ceil(diff / 3600000);
    if (hours < 24) return hours + " 小时后";
    return Math.ceil(hours / 24) + " 天后";
  }

  window.VocabSRS = { RATINGS, apply, isDue, dueLabel, addDays };
})();
