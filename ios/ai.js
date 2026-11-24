/* =========================================================
   AI 拓展接口（默认不启用、不发送任何网络请求）
   在“我的 → AI 拓展配置”填写 OpenAI 兼容接口后即可调用。
   生产环境建议通过自己的服务端代理保存密钥，避免前端暴露 API Key。
   ========================================================= */
(function () {
  "use strict";

  function getConfig() {
    return window.VocabStore.getState().settings.ai || {};
  }

  function assertConfigured() {
    const config = getConfig();
    if (!config.endpoint) throw new Error("请先在“我的”页面配置 AI 接口地址。 ");
    return config;
  }

  async function request(systemPrompt, userPrompt) {
    const config = assertConfigured();
    const base = config.endpoint.trim().replace(/\/$/, "");
    const url = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: "Bearer " + config.apiKey } : {})
        },
        body: JSON.stringify({
          model: config.model || "gpt-4o-mini",
          temperature: 0.4,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error("AI 接口返回 " + response.status + "，请检查配置。 ");
      const data = await response.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error("AI 接口未返回有效内容。 ");
      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  const AI = {
    /** 自动生成更贴合当前词汇的例句与搭配。 */
    generateExample(word) {
      return request(
        "你是英语词汇教学助手。给出自然、简短、适合大学英语学习者的内容。",
        `为单词 ${word.word}（${word.meaning}）生成 3 个高频搭配和 1 个英文例句，并附例句中文翻译。`
      );
    },
    /** 批改造句：指出语法、搭配问题并给优化版本。 */
    reviewSentence(word, sentence) {
      return request(
        "你是严谨的英语写作教练。请用中文简洁反馈，按“问题、建议、优化句”三部分回答。",
        `目标词：${word.word}；释义：${word.meaning}。请批改这句英语：${sentence}`
      );
    },
    /** 针对当前词汇生成专项练习。 */
    generateExercises(word) {
      return request(
        "你是英语练习题设计助手。输出题目后单独列出答案。",
        `围绕 ${word.word}（${word.meaning}）生成 2 道语境填空和 1 道中译英练习。`
      );
    },
    /** 根据学习记录辅助评估是否适合进入主动库。 */
    evaluatePromotion(word) {
      return request(
        "你是词汇学习评估助手。只输出“适合”或“暂缓”，再用两句话解释。",
        `单词：${word.word}；掌握评分：${word.mastery}；答对次数：${word.correctCount}；答错次数：${word.wrongCount}；连续答错：${word.consecutiveWrong}。评估是否适合升级为主动词汇。`
      );
    },
    request
  };

  window.VocabAI = AI;
})();
