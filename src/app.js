/**
 * app.js —— 页面交互（刻意保持很小，重点在 CSS 组件本身）
 * 1) 明暗主题切换（令牌换值，组件自动跟随）
 * 2) 演示按钮 / 卡片的点击日志（含 aria-disabled 的点击拦截）
 * 3) 信息流筛选（aria-pressed 同步）
 * 4) 可点击卡片的键盘支持（Enter / Space）
 */
(() => {
  'use strict';

  const THEME_KEY = 'dsl-theme';
  const root = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');
  const logPanel = document.getElementById('demo-log');
  const logLines = [];

  /** 在日志面板里追加一行（保留最近 6 条） */
  function log(message) {
    if (!logPanel) return;
    logLines.unshift(message);
    logPanel.textContent = logLines.slice(0, 6).join('\n');
  }

  // ---------------------------------------------------------------- 主题
  function syncThemeButton() {
    if (!themeToggle) return;
    const isDark = root.dataset.theme === 'dark';
    themeToggle.setAttribute('aria-pressed', String(isDark));
    themeToggle.textContent = isDark ? '☀️ 亮色' : '🌙 暗色';
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      root.dataset.theme = 'dark';
    } else {
      delete root.dataset.theme;
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* 隐私模式等场景下忽略 */
    }
    syncThemeButton();
  }

  themeToggle?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    log(`切换主题：${next === 'dark' ? '暗色（data-theme="dark"）' : '亮色（默认 :root）'}`);
  });
  syncThemeButton();

  // ---------------------------------------------------------------- 演示按钮
  document.addEventListener('click', (event) => {
    const demo = event.target.closest('[data-demo]');
    if (!demo) return;
    if (demo.closest('[aria-disabled="true"]')) {
      log('点击被拦截：aria-disabled="true" 的元素不会响应操作');
      return;
    }
    const label = demo.getAttribute('aria-label') || demo.textContent.trim().replace(/\s+/g, ' ');
    log(`点击按钮：「${label}」`);
  });

  // ---------------------------------------------------------------- 不可点击的卡片（事件委托）
  function tryOpenCard(card) {
    if (!card) return;
    if (card.getAttribute('aria-disabled') === 'true') {
      log('点击被拦截：这张卡片处于 aria-disabled="true" 状态');
      return;
    }
    const title = card.dataset.title || '未命名卡片';
    log(`打开卡片：「${title}」`);
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest('.card--interactive');
    if (!card) return;
    // 卡片内部按钮 / 链接优先处理，不触发整卡点击
    if (event.target.closest('button, a')) return;
    tryOpenCard(card);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.card--interactive');
    if (!card || event.target !== card) return;
    event.preventDefault();
    tryOpenCard(card);
  });

  // ---------------------------------------------------------------- 信息流筛选
  const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));
  const cards = Array.from(document.querySelectorAll('#feed .card'));

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      filterButtons.forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      let visible = 0;
      cards.forEach((card) => {
        const match = filter === 'all' || card.dataset.topic === filter;
        card.hidden = !match;
        if (match) visible += 1;
      });
      log(`筛选「${button.textContent.trim()}」：显示 ${visible} 张卡片`);
    });
  });
})();
