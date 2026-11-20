/**
 * DSL Token Bridge —— design-system-lab 专用 Figma 本地开发插件
 * =============================================================================
 * 纯脚本（不是 ES module），整段包在 async IIFE 里，方便用 await。
 * 语法检查：node --check figma/plugin/code.js
 *
 * 它做两件事：
 *   ① 导入：把 ui.html 里粘贴的 tokens/tokens.json 变成 Figma 变量 + Button / FeedCard 组件集
 *   ② 导出：把当前文件里 "Design Tokens*" 集合的本地变量，还原成 Tokens Studio 兼容 JSON
 *
 * 设计原则（很重要）：
 *   - 变量优先：变量创建失败就记日志继续，绝不整体中断；
 *   - 组件其次：组件生成全部包在 try/catch 里，失败只影响组件，不影响变量；
 *   - 渐进式：不确定的能力（多模式、某个 setBoundVariable 字段、实例文字覆盖）
 *     一律先 try 再 catch，失败降级并说明，不假设 API 一定存在。
 *
 * 命名契约（与 scripts/build-tokens.mjs 严格一致）：
 *   token 路径去掉最外层 set 名 —— CSS 用 "-" 连接并加 "--"，Figma 变量用 "/" 连接。
 *   semantic.color.bg.surface-hover  ->  --color-bg-surface-hover  <->  color/bg/surface-hover
 */

(async () => {
  'use strict';

  /* ============================================================
   * 0. 常量、样式表、状态
   * ============================================================ */

  const COLLECTION_NAME = 'Design Tokens';
  // 免费版没有 Dark 模式，导出时用它把上次导入的 dark 段补回来（存在 figma.root 上，按文件隔离）
  const LAST_DARK_PLUGIN_DATA = 'dsl-last-dark-json';
  /**
   * 把"哪些变量来自 core set"记在集合的 pluginData 里。
   * 为什么需要它：CSS 变量名里不含 set 名，导出时光看变量名分不出 core / semantic；
   * 而 scripts/build-tokens.mjs 要求 tokens.json 里必须有 core 这个 set。
   * 记下来之后，导出就能原样还原 core / semantic 两个分组。
   */
  const CORE_KEYS_PLUGIN_DATA = 'dslCoreKeys';
  const SET_ORDER = ['core', 'semantic', 'dark'];
  const CARD_WIDTH = 560;
  const BUTTON_VARIANTS = ['Primary', 'Secondary', 'Ghost'];
  const BUTTON_STATES = ['Default', 'Hover', 'Pressed', 'Disabled'];
  const CARD_STATES = ['Default', 'Hover', 'Pressed', 'Disabled'];

  /** 字体候选：从前往后找第一个整族可用的；Inter 是 Figma 预加载的，通常必中 */
  const FONT_FAMILIES = ['Inter', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC'];

  /** tokens.json 的 token type -> Figma 变量的 resolvedType */
  const TOKEN_TYPE_TO_FIGMA = {
    color: 'COLOR',
    spacing: 'FLOAT',
    sizing: 'FLOAT',
    borderRadius: 'FLOAT',
    fontSizes: 'FLOAT',
    fontWeights: 'FLOAT',
    lineHeights: 'FLOAT',
    duration: 'FLOAT',
    borderWidth: 'FLOAT',
    letterSpacing: 'FLOAT',
    paragraphSpacing: 'FLOAT',
    opacity: 'FLOAT',
    number: 'FLOAT',
    cubicBezier: 'STRING',
    boxShadow: 'STRING',
    fontFamilies: 'STRING',
    string: 'STRING',
    other: 'STRING',
  };

  /** Button：variant × state -> 用哪个颜色 token（键就是 Figma 变量名） */
  const BUTTON_STYLE = {
    Primary: {
      fill: {
        Default: 'color/brand/bg',
        Hover: 'color/brand/bg-hover',
        Pressed: 'color/brand/bg-active',
        Disabled: 'color/disabled/bg',
      },
      text: {
        Default: 'color/text/on-brand',
        Hover: 'color/text/on-brand',
        Pressed: 'color/text/on-brand',
        Disabled: 'color/disabled/text',
      },
      border: {
        Disabled: 'color/disabled/border',
      },
    },
    Secondary: {
      fill: {
        Default: 'color/bg/surface',
        Hover: 'color/bg/surface-hover',
        Pressed: 'color/bg/surface-active',
        Disabled: 'color/disabled/bg',
      },
      text: {
        Default: 'color/text/primary',
        Hover: 'color/text/primary',
        Pressed: 'color/text/primary',
        Disabled: 'color/disabled/text',
      },
      border: {
        Default: 'color/border/default',
        Hover: 'color/border/strong',
        Pressed: 'color/border/strong',
        Disabled: 'color/disabled/border',
      },
    },
    Ghost: {
      fill: {
        Default: null, // 透明背景
        Hover: 'color/bg/surface-hover',
        Pressed: 'color/bg/surface-active',
        Disabled: 'color/disabled/bg',
      },
      text: {
        Default: 'color/text/secondary',
        Hover: 'color/text/secondary',
        Pressed: 'color/text/primary',
        Disabled: 'color/disabled/text',
      },
      border: {
        Disabled: 'color/disabled/border',
      },
    },
  };

  /** FeedCard：state -> 背景 / 边框 / 阴影 token */
  const CARD_STYLE = {
    Default: { fill: 'color/bg/surface', border: 'color/border/subtle', shadow: 'shadow/card' },
    Hover: { fill: 'color/bg/surface', border: 'color/border/default', shadow: 'shadow/card-hover' },
    Pressed: { fill: 'color/bg/surface', border: 'color/border/default', shadow: 'shadow/card' },
    Disabled: { fill: 'color/disabled/bg', border: 'color/disabled/border', shadow: null },
  };

  /** FeedCard：state -> 各段文字 / 标签用的颜色 token */
  const CARD_TEXT = {
    Default: {
      meta: 'color/text/primary',
      time: 'color/text/muted',
      title: 'color/text/primary',
      body: 'color/text/secondary',
      tagBg: 'color/tag/bg',
      tagText: 'color/tag/text',
    },
    Hover: {
      meta: 'color/text/primary',
      time: 'color/text/muted',
      title: 'color/text/primary',
      body: 'color/text/secondary',
      tagBg: 'color/tag/bg',
      tagText: 'color/tag/text',
    },
    Pressed: {
      meta: 'color/text/primary',
      time: 'color/text/muted',
      title: 'color/text/primary',
      body: 'color/text/secondary',
      tagBg: 'color/tag/bg',
      tagText: 'color/tag/text',
    },
    Disabled: {
      meta: 'color/disabled/text',
      time: 'color/disabled/text',
      title: 'color/disabled/text',
      body: 'color/disabled/text',
      tagBg: 'color/disabled/bg',
      tagText: 'color/disabled/text',
    },
  };

  const CARD_BODY =
    'A short paragraph of body copy that explains why this card exists. ' +
    'It wraps at the card width so the line length stays comfortable.';

  const state = {
    tokens: null, // 解析后的 tokens.json 根对象
    entries: new Map(), // key = Figma 变量名（如 color/bg/canvas）-> 条目
    vars: new Map(), // key = Figma 变量名 -> Variable 对象
    fonts: null, // { family, regular, semibold }
  };

  /* ============================================================
   * 1. 基础设施：日志 / 小工具
   * ============================================================ */

  function log(message, level) {
    const lv = level || 'info';
    try {
      figma.ui.postMessage({ type: 'log', level: lv, message: String(message) });
    } catch (err) {
      /* UI 还没准备好时忽略，控制台仍然有输出 */
    }
    const prefix =
      lv === 'error' ? '[错误]' : lv === 'warn' ? '[提醒]' : lv === 'success' ? '[完成]' : '[信息]';
    console.log(prefix + ' ' + message);
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function clamp01(n) {
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  /* ============================================================
   * 2. 颜色解析（tokens.json 里会出现的几种写法）
   * ============================================================ */

  /**
   * 把 "#rrggbb" / "#rgb" / "#rrggbbaa" / "rgb(37 99 235 / 0.16)" / "rgba(37, 99, 235, 0.16)"
   * 解析成 Figma 需要的 { r, g, b, a }（0~1 浮点）。解析失败返回 null。
   */
  function parseColor(input) {
    if (typeof input !== 'string') return null;
    const text = input.trim().toLowerCase();

    const hexMatch = text.match(/^#([0-9a-f]{3,8})$/);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = hex
          .split('')
          .map((ch) => ch + ch)
          .join('');
      }
      if (hex.length !== 6 && hex.length !== 8) return null;
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (![r, g, b].every(Number.isFinite)) return null;
      return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a: clamp01(a) };
    }

    // rgb() / rgba()：同时支持 "37 99 235 / 0.16" 与 "37, 99, 235, 0.16"
    const fnMatch = text.match(/^rgba?\(([^)]*)\)$/);
    if (fnMatch) {
      const parts = fnMatch[1].split('/');
      const numbers = parts[0]
        .trim()
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((piece) => Number(piece));
      let alpha = parts.length > 1 ? Number(parts[1].trim()) : 1;
      if (parts.length === 1 && numbers.length === 4) alpha = numbers[3];
      if (numbers.length < 3) return null;
      if (!numbers.slice(0, 3).every(Number.isFinite)) return null;
      if (!Number.isFinite(alpha)) alpha = 1;
      return {
        r: clamp01(numbers[0] / 255),
        g: clamp01(numbers[1] / 255),
        b: clamp01(numbers[2] / 255),
        a: clamp01(alpha),
      };
    }

    return null;
  }

  /** Figma 的 { r, g, b, a } -> Tokens Studio 习惯的字符串（不透明用 hex，带 alpha 用 rgb( / a)） */
  function colorToCss(color) {
    if (!color || typeof color.r !== 'number') return null;
    const to255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    const a = typeof color.a === 'number' ? round3(color.a) : 1;
    if (a >= 1) {
      return (
        '#' +
        [color.r, color.g, color.b]
          .map((v) => to255(v).toString(16).padStart(2, '0'))
          .join('')
      );
    }
    return 'rgb(' + to255(color.r) + ' ' + to255(color.g) + ' ' + to255(color.b) + ' / ' + a + ')';
  }

  /**
   * 把 tokens.json 里的 boxShadow 字符串解析成 Figma Effect 数组。
   * 只认 CSS 的 "x y blur spread color" 形式（本仓库的 shadow token 就是这种）。
   * 解析不出来返回空数组，调用方降级处理。
   */
  function parseShadowEffects(value) {
    const effects = [];
    if (typeof value !== 'string') return effects;
    // 注意：CSS 允许 0 不带单位（"0 1px 2px 0 rgb(...)"），所以 px 是可选的
    const re =
      /(-?\d*\.?\d+)(?:px)?\s+(-?\d*\.?\d+)(?:px)?\s+(-?\d*\.?\d+)(?:px)?\s+(-?\d*\.?\d+)(?:px)?\s+(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/g;
    let match = re.exec(value);
    while (match) {
      const color = parseColor(match[5]);
      if (color) {
        effects.push({
          type: 'DROP_SHADOW',
          color: { r: color.r, g: color.g, b: color.b, a: color.a },
          offset: { x: Number(match[1]), y: Number(match[2]) },
          radius: Number(match[3]),
          spread: Number(match[4]),
          visible: true,
          blendMode: 'NORMAL',
        });
      }
      match = re.exec(value);
    }
    return effects;
  }

  /* ============================================================
   * 3. tokens.json 展平 + 引用解析
   * ============================================================ */

  function isToken(node) {
    return Boolean(node) && typeof node === 'object' && hasOwn(node, 'value');
  }

  /** 递归展平一个 set，规则与 build-tokens.mjs 一致：有 value 字段就是 token */
  function flattenSet(setName, node, prefix, out) {
    if (!node || typeof node !== 'object') return;
    if (isToken(node)) {
      if (prefix.length) out.push({ set: setName, path: prefix, token: node });
      return;
    }
    for (const key of Object.keys(node)) {
      flattenSet(setName, node[key], prefix.concat(key), out);
    }
  }

  /**
   * 把所有 set 合并成"按变量名索引"的表：
   *   key（Figma 变量名，如 color/bg/canvas）-> { key, path, set, token, darkToken }
   * core/semantic 提供 Light 值，dark 提供 Dark 覆盖值。
   */
  function collectEntries(root) {
    const map = new Map();
    const warnings = [];

    for (const setName of SET_ORDER) {
      const setNode = root[setName];
      if (!setNode || typeof setNode !== 'object') {
        if (setName !== 'dark') warnings.push('tokens.json 里没有找到 set "' + setName + '"');
        continue;
      }
      const flat = [];
      flattenSet(setName, setNode, [], flat);

      for (const item of flat) {
        const key = item.path.join('/');
        if (!key) continue;
        const existing = map.get(key);

        if (setName === 'dark') {
          if (!existing) {
            warnings.push(
              '暗色 token ' + key + ' 在 core/semantic 里没有同路径的基础 token，已跳过（编译器也会报错）'
            );
            continue;
          }
          existing.darkToken = item.token;
          continue;
        }

        if (existing) {
          warnings.push(
            '变量名重复：' + key + '（' + existing.set + ' 与 ' + setName + '），保留先出现的那个'
          );
          continue;
        }

        map.set(key, {
          key: key,
          path: item.path.slice(),
          set: setName,
          token: item.token,
          darkToken: null,
        });
      }
    }

    return { map: map, warnings: warnings };
  }

  /** "{color.gray.50}" -> ['color','gray','50']；不是引用就返回 null */
  function parseRef(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^\{([^{}]+)\}$/);
    if (!match) return null;
    const segments = match[1]
      .split('.')
      .map((piece) => piece.trim())
      .filter(Boolean);
    return segments.length ? segments : null;
  }

  /** 在 tokens 根对象里找引用目标：先按完整路径（可能带 set 名），再按 core→semantic→dark 找 */
  function findToken(segments) {
    const root = state.tokens;
    if (!root) return null;

    let node = root;
    let ok = true;
    for (const seg of segments) {
      if (node && typeof node === 'object' && hasOwn(node, seg)) node = node[seg];
      else {
        ok = false;
        break;
      }
    }
    if (ok && isToken(node)) return node;

    for (const setName of SET_ORDER) {
      let cursor = root[setName];
      if (!cursor || typeof cursor !== 'object') continue;
      let found = true;
      for (const seg of segments) {
        if (cursor && typeof cursor === 'object' && hasOwn(cursor, seg)) cursor = cursor[seg];
        else {
          found = false;
          break;
        }
      }
      if (found && isToken(cursor)) return cursor;
    }
    return null;
  }

  /** 把 token 的 value 追到最终字面值（跟着 {引用} 一路走到底），带循环保护 */
  function resolveLiteral(token, seen) {
    const chain = seen || [];
    if (!token) return undefined;
    const raw = token.value;
    if (typeof raw !== 'string') return raw;

    const ref = parseRef(raw);
    if (!ref) return raw;

    const key = ref.join('.');
    if (chain.indexOf(key) !== -1) {
      log('检测到循环引用：' + chain.concat(key).join(' -> ') + '，已按字面值处理', 'warn');
      return raw;
    }
    const target = findToken(ref);
    if (!target) {
      log('找不到引用目标 {' + key + '}，已按字面值处理', 'warn');
      return raw;
    }
    return resolveLiteral(target, chain.concat(key));
  }

  /**
   * 若 token 的值是引用，返回它对应的 Figma 变量名（去掉可能出现的 set 前缀）。
   * 例：{color.gray.50} -> color/gray/50 ；{core.color.gray.50} -> color/gray/50
   */
  function aliasTargetName(token) {
    if (!token) return null;
    const ref = parseRef(token.value);
    if (!ref) return null;
    let segments = ref.slice();
    if (SET_ORDER.indexOf(segments[0]) !== -1) segments = segments.slice(1);
    return segments.length ? segments.join('/') : null;
  }

  /* ============================================================
   * 4. 变量：类型映射、值计算、创建
   * ============================================================ */

  function figmaTypeOf(token) {
    if (!token) return null;
    const type = token.type;
    if (type && TOKEN_TYPE_TO_FIGMA[type]) return TOKEN_TYPE_TO_FIGMA[type];
    if (typeof token.value === 'number') return 'FLOAT';
    if (typeof token.value === 'string') return 'STRING';
    return null;
  }

  /**
   * 计算某个 token 在某个模式下应该写入的值。
   * 返回 { value } / { alias: Variable } / { error: string }
   */
  function computeValue(entry, token, resolvedType) {
    // 1) 引用 + 目标变量已经建好 + 类型一致 -> 别名（Figma 里就是"引用变量"）
    const targetName = aliasTargetName(token);
    if (targetName) {
      const targetVar = state.vars.get(targetName);
      if (targetVar && targetVar.resolvedType === resolvedType) {
        return { alias: targetVar };
      }
    }

    // 2) 否则写入解析后的字面值
    const raw = resolveLiteral(token, []);
    if (raw === undefined || raw === null) return { error: '空值' };

    if (resolvedType === 'COLOR') {
      const color = parseColor(String(raw));
      if (!color) return { error: '颜色无法解析："' + String(raw) + '"' };
      return { value: color };
    }
    if (resolvedType === 'FLOAT') {
      const num = Number(raw);
      if (!Number.isFinite(num)) return { error: '数值无法解析："' + String(raw) + '"' };
      return { value: num };
    }
    if (typeof raw === 'object') {
      return { error: '复合 token（对象值）暂不支持' };
    }
    return { value: String(raw) };
  }

  /** 找到或新建变量集合；已存在就复用（重复运行插件不会堆出一堆同名集合） */
  async function ensureCollection() {
    let collections = [];
    try {
      collections = await figma.variables.getLocalVariableCollectionsAsync();
    } catch (err) {
      log('读取变量集合失败：' + err.message, 'warn');
    }
    const found = collections.find((collection) => collection.name === COLLECTION_NAME);
    if (found) {
      log('复用已存在的变量集合 "' + COLLECTION_NAME + '"');
      return found;
    }
    const created = figma.variables.createVariableCollection(COLLECTION_NAME);
    log('已创建变量集合 "' + COLLECTION_NAME + '"');
    return created;
  }

  /**
   * 准备 Light / Dark 两个模式。
   * 免费 Starter 套餐变量集合只有 1 个模式，addMode 会抛错 —— 这时降级为单模式，不中断。
   */
  function ensureModes(collection) {
    const lightModeId = collection.modes[0] && collection.modes[0].modeId;
    if (!lightModeId) throw new Error('变量集合没有默认模式，无法写入值');

    if (collection.modes[0].name !== 'Light') {
      try {
        collection.renameMode(lightModeId, 'Light');
      } catch (err) {
        log('把第一个模式改名为 Light 失败（可以忽略）：' + err.message, 'warn');
      }
    }

    let darkModeId = null;
    const existingDark = collection.modes.find((mode) => mode.name === 'Dark');
    if (existingDark) {
      darkModeId = existingDark.modeId;
    } else {
      try {
        darkModeId = collection.addMode('Dark');
        log('已添加 Dark 模式，暗色 token 会写进这个模式');
      } catch (err) {
        darkModeId = null;
        log(
          '当前 Figma 套餐不支持多模式（免费版每个变量集合只有 1 个模式）：已降级为单模式，' +
            '只写入 Light 值，暗色相关的 token 被跳过。多模式需要 Figma 付费套餐。',
          'warn'
        );
      }
    }

    return { lightModeId: lightModeId, darkModeId: darkModeId };
  }

  /** 把 entry 集合变成 Figma 变量 + 各模式的值 */
  async function createVariables(map) {
    const stats = { created: 0, updated: 0, skipped: 0, dark: false, total: map.size };
    const collection = await ensureCollection();
    const modes = ensureModes(collection);
    stats.dark = Boolean(modes.darkModeId);

    // 记下哪些变量来自 core set，导出时用来还原 core / semantic 分组
    try {
      const coreKeys = [];
      for (const entry of map.values()) {
        if (entry.set === 'core') coreKeys.push(entry.key);
      }
      collection.setPluginData(CORE_KEYS_PLUGIN_DATA, JSON.stringify(coreKeys));
    } catch (err) {
      log('记录 core 变量清单失败（导出时会退化为全部放在 semantic）：' + err.message, 'warn');
    }

    let existingVariables = [];
    try {
      existingVariables = await figma.variables.getLocalVariablesAsync();
    } catch (err) {
      log('读取已有变量失败：' + err.message, 'warn');
    }
    const byName = new Map();
    for (const variable of existingVariables) {
      if (variable.variableCollectionId === collection.id) byName.set(variable.name, variable);
    }

    // 集合里"上次留下的"变量：本次 tokens.json 没有、但还躺在 Figma 里。
    // 它们不会影响本次导入，但导出时会被一起导出去，所以先提醒一句。
    const staleNames = [];
    for (const name of byName.keys()) {
      if (!map.has(name)) staleNames.push(name);
    }
    if (staleNames.length) {
      log(
        '提醒：集合里还有 ' +
          staleNames.length +
          ' 个变量不在本次 tokens.json 里（例如 ' +
          staleNames.slice(0, 3).join('、') +
          '）。它们不会被删除，导出时仍会出现；想保持干净就手动删掉。',
        'warn'
      );
    }

    // ---- 第一遍：确保变量存在，并写入 Light 值 ----
    for (const entry of map.values()) {
      const resolvedType = figmaTypeOf(entry.token);
      if (!resolvedType) {
        stats.skipped += 1;
        log('跳过 ' + entry.key + '：不认识的 token 类型 "' + entry.token.type + '"', 'warn');
        continue;
      }

      const computed = computeValue(entry, entry.token, resolvedType);
      if (computed.error) {
        stats.skipped += 1;
        log('跳过 ' + entry.key + '：' + computed.error, 'warn');
        continue;
      }

      let variable = byName.get(entry.key);
      const isExisting = Boolean(variable);
      if (variable) {
        if (variable.resolvedType !== resolvedType) {
          stats.skipped += 1;
          log(
            '跳过 ' +
              entry.key +
              '：已有同名变量但类型是 ' +
              variable.resolvedType +
              '，本次需要 ' +
              resolvedType +
              '（Figma 不支持改变变量类型）',
            'warn'
          );
          continue;
        }
        stats.updated += 1;
      } else {
        try {
          variable = figma.variables.createVariable(entry.key, collection, resolvedType);
          byName.set(entry.key, variable);
          stats.created += 1;
        } catch (err) {
          stats.skipped += 1;
          log('创建变量 ' + entry.key + ' 失败：' + err.message, 'error');
          continue;
        }
      }

      state.vars.set(entry.key, variable);

      try {
        const value = computed.alias
          ? figma.variables.createVariableAlias(computed.alias)
          : computed.value;
        variable.setValueForMode(modes.lightModeId, value);
      } catch (err) {
        stats.skipped += 1;
        if (isExisting) stats.updated -= 1; // 写失败就不算"更新成功"，避免统计重复计数
        log('写入 ' + entry.key + ' 的 Light 值失败：' + err.message, 'error');
      }
    }

    // ---- 第二遍：写 Dark 值（只有确实有 Dark 模式时才做）----
    if (modes.darkModeId) {
      for (const entry of map.values()) {
        const variable = state.vars.get(entry.key);
        if (!variable) continue;
        // 没有 darkToken 的变量也要显式写一次 Dark 值（= Light 值）：
        // 否则新变量在 Dark 列可能停在创建时的默认值，导出时被误判成"暗色覆盖"。
        const darkSource = entry.darkToken || entry.token;
        const computed = computeValue(entry, darkSource, variable.resolvedType);
        if (computed.error) {
          log('跳过暗色值 ' + entry.key + '：' + computed.error, 'warn');
          continue;
        }
        try {
          const value = computed.alias
            ? figma.variables.createVariableAlias(computed.alias)
            : computed.value;
          variable.setValueForMode(modes.darkModeId, value);
        } catch (err) {
          log('写入 ' + entry.key + ' 的 Dark 值失败：' + err.message, 'warn');
        }
      }
    }

    log(
      '变量处理完成：新建 ' +
        stats.created +
        '，更新 ' +
        stats.updated +
        '，跳过 ' +
        stats.skipped +
        '（共 ' +
        stats.total +
        ' 个 token）',
      'success'
    );
    return stats;
  }

  /* ============================================================
   * 5. 取用 token 值 / 绑定变量 的小工具
   * ============================================================ */

  /** 变量名 -> Variable（没建成功就是 undefined） */
  function varOf(key) {
    return state.vars.get(key);
  }

  /** 变量名 -> 解析后的字面值（不管变量有没有建成功都能拿到，用来兜底） */
  function literalOf(key) {
    const entry = state.entries.get(key);
    if (!entry) return undefined;
    return resolveLiteral(entry.token, []);
  }

  function numberOf(key, fallback) {
    const raw = literalOf(key);
    const num = Number(raw);
    return Number.isFinite(num) ? num : fallback;
  }

  /** 生成一个"颜色已绑定变量"的 SOLID 填充；变量不存在就退化成字面值 */
  function colorPaintOf(key) {
    const rgba = parseColor(String(literalOf(key))) || { r: 0.5, g: 0.5, b: 0.5, a: 1 };

    // 优先绑定变量：变量本身已经带 alpha，这里不要再设 paint.opacity，否则半透明色会被乘两次。
    const variable = varOf(key);
    if (variable) {
      try {
        return figma.variables.setBoundVariableForPaint(
          { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b } },
          'color',
          variable
        );
      } catch (err) {
        log('绑定颜色变量 ' + key + ' 失败（已用字面值）：' + err.message, 'warn');
      }
    }

    // 没有变量时用字面值兜底，透明度用 paint.opacity 表达
    const paint = { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b } };
    if (rgba.a < 1) paint.opacity = rgba.a;
    return paint;
  }

  /** 把数字类变量绑到节点字段上；失败就跳过（不同 Figma 版本支持的字段不完全一样） */
  function tryBind(node, field, key) {
    const variable = varOf(key);
    if (!variable || !node || typeof node.setBoundVariable !== 'function') return false;
    try {
      node.setBoundVariable(field, variable);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** 让节点在父级 auto layout 里横向填满 */
  function fillWidth(node) {
    try {
      node.layoutSizingHorizontal = 'FILL';
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ============================================================
   * 6. 字体
   * ============================================================ */

  function pickStyle(styles, preferences) {
    for (const preference of preferences) {
      const hit = styles.find((style) => style.toLowerCase() === preference.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }

  /**
   * 挑一个可用字体族，并加载 Regular / Semi Bold 两个字重。
   * 找不到就返回 null（组件生成整体跳过，但变量已经建好了）。
   */
  async function pickFonts() {
    let available = [];
    try {
      available = await figma.listAvailableFontsAsync();
    } catch (err) {
      log('读取字体列表失败：' + err.message, 'warn');
    }

    const families = new Map();
    for (const item of available) {
      const fontName = item && item.fontName;
      if (!fontName || !fontName.family) continue;
      if (!families.has(fontName.family)) families.set(fontName.family, []);
      if (fontName.style) families.get(fontName.family).push(fontName.style);
    }

    const candidates = FONT_FAMILIES.slice();
    if (!candidates.some((family) => families.has(family)) && families.size) {
      for (const family of families.keys()) candidates.push(family);
    }

    for (const family of candidates) {
      const styles = families.get(family);
      if (!styles || !styles.length) continue;

      const regular =
        pickStyle(styles, ['Regular', 'Normal', 'Book', 'Roman', 'Medium', 'W3']) || styles[0];
      const semibold =
        pickStyle(styles, ['Semi Bold', 'SemiBold', 'Semibold', 'Demi Bold', 'DemiBold', 'Bold', 'Medium']) ||
        regular;

      try {
        await figma.loadFontAsync({ family: family, style: regular });
        if (semibold !== regular) {
          await figma.loadFontAsync({ family: family, style: semibold });
        }
        log('组件示例文案使用字体：' + family + '（' + regular + ' / ' + semibold + '）');
        return {
          family: family,
          regular: { family: family, style: regular },
          semibold: { family: family, style: semibold },
        };
      } catch (err) {
        log('字体 ' + family + ' 加载失败，换下一个候选：' + err.message, 'warn');
      }
    }

    return null;
  }

  /* ============================================================
   * 7. 组件：Button / FeedCard
   * ============================================================ */

  function createTextNode(content, colorKey, fontSize, fontName) {
    const text = figma.createText();
    text.fontName = fontName; // 字体必须在 pickFonts 里 loadFontAsync 过
    text.characters = content;
    text.fontSize = fontSize;
    text.textAutoResize = 'WIDTH_AND_HEIGHT';
    text.fills = [colorPaintOf(colorKey)];
    return text;
  }

  function createPlainFrame(name, direction, gap) {
    const frame = figma.createFrame();
    frame.name = name;
    frame.fills = [];
    frame.strokes = [];
    frame.layoutMode = direction;
    frame.primaryAxisSizingMode = 'AUTO';
    frame.counterAxisSizingMode = 'AUTO';
    frame.itemSpacing = gap;
    return frame;
  }

  /** 单个 Button 变体（md 尺寸，高 40） */
  function createButtonComponent(variant, stateName) {
    const style = BUTTON_STYLE[variant];
    const component = figma.createComponent();
    component.name = 'Variant=' + variant + ', State=' + stateName;
    component.fills = [];
    component.strokes = [];

    // 布局：横向 auto layout，左右 16，垂直居中
    component.layoutMode = 'HORIZONTAL';
    component.primaryAxisSizingMode = 'AUTO';
    component.counterAxisSizingMode = 'FIXED';
    component.primaryAxisAlignItems = 'CENTER';
    component.counterAxisAlignItems = 'CENTER';
    component.itemSpacing = numberOf('space/1', 4); // 图标与文字之间（本版没有图标，留作扩展）

    const paddingX = numberOf('space/4', 16);
    component.paddingLeft = paddingX;
    component.paddingRight = paddingX;
    component.paddingTop = 0;
    component.paddingBottom = 0;

    component.cornerRadius = numberOf('radius/control', 10);

    // 背景 / 描边
    const fillKey = style.fill[stateName];
    component.fills = fillKey ? [colorPaintOf(fillKey)] : [];
    const borderKey = style.border[stateName];
    if (borderKey) {
      component.strokes = [colorPaintOf(borderKey)];
      component.strokeWeight = 1;
      try {
        component.strokeAlign = 'INSIDE';
      } catch (err) {
        /* 老版本没有 strokeAlign，忽略 */
      }
    }

    // 文案（用英文，避免中文字形缺失）
    const label = createTextNode(
      'Button',
      style.text[stateName],
      numberOf('font/size/body', 16),
      state.fonts.semibold
    );
    component.appendChild(label);
    // 字号、字重都可以绑定变量（官方 VariableBindableTextField 包含 fontSize / fontWeight）
    tryBind(label, 'fontSize', 'font/size/body');
    tryBind(label, 'fontWeight', 'font/weight/semibold');

    // 固定高度：先 resize，再用变量覆盖（值一样，顺便演示"高度也能绑 token"）
    try {
      component.counterAxisSizingMode = 'FIXED';
      component.resize(component.width, numberOf('size/control-height-md', 40));
      // resize() 会把宽、高都设成 FIXED。这里把宽度恢复成"随文字自适应"，
      // 否则 FeedCard 里把实例文字改成 "Read more" 时会被裁掉（高度仍固定 40）。
      component.primaryAxisSizingMode = 'AUTO';
    } catch (err) {
      /* resize 失败不影响后续绑定 */
    }

    tryBind(component, 'height', 'size/control-height-md');
    tryBind(component, 'cornerRadius', 'radius/control');
    tryBind(component, 'paddingLeft', 'space/4');
    tryBind(component, 'paddingRight', 'space/4');
    tryBind(component, 'itemSpacing', 'space/1');

    return component;
  }

  /** 生成 3 variant × 4 state = 12 个 Button 组件，并合并成组件集 */
  function buildButtonSet() {
    const components = [];
    const byKey = new Map();

    for (const variant of BUTTON_VARIANTS) {
      for (const stateName of BUTTON_STATES) {
        try {
          const component = createButtonComponent(variant, stateName);
          components.push(component);
          byKey.set(variant + '/' + stateName, component);
        } catch (err) {
          log('创建 Button ' + variant + '/' + stateName + ' 失败：' + err.message, 'error');
        }
      }
    }

    let set = null;
    if (components.length) {
      try {
        set = figma.combineAsVariants(components, figma.currentPage);
        set.name = 'Button';
        log('Button 组件集已生成：' + components.length + ' 个变体（Variant × State）', 'success');
      } catch (err) {
        log('合并 Button 变体失败（组件仍然各自保留在画布上）：' + err.message, 'error');
      }
    }
    return { set: set, byKey: byKey, count: components.length };
  }

  /** 往父节点里塞一个 Button 组件实例，并覆盖文字 */
  function addButtonInstance(parent, buttonComponent, label) {
    if (!buttonComponent) return null;
    try {
      const instance = buttonComponent.createInstance();
      instance.name = 'Button / ' + label;
      const textNode = instance.findOne((node) => node.type === 'TEXT');
      if (textNode) textNode.characters = label;
      // 覆盖文字后让实例宽度重新自适应（组件本身是 HUG 宽）
      try {
        instance.primaryAxisSizingMode = 'AUTO';
      } catch (err) {
        /* 老版本 API 不支持时忽略 */
      }
      parent.appendChild(instance);
      return instance;
    } catch (err) {
      log('创建按钮实例失败（' + label + '）：' + err.message, 'warn');
      return null;
    }
  }

  /** 标签（.tag）：小圆角药丸 */
  function createTag(label, tagBgKey, tagTextKey, tagBorderKey) {
    const tag = figma.createFrame();
    tag.name = 'tag';
    tag.fills = [];
    tag.strokes = [];
    tag.layoutMode = 'HORIZONTAL';
    tag.primaryAxisSizingMode = 'AUTO';
    tag.counterAxisSizingMode = 'AUTO';
    tag.primaryAxisAlignItems = 'CENTER';
    tag.counterAxisAlignItems = 'CENTER';
    tag.paddingLeft = 10;
    tag.paddingRight = 10;
    tag.paddingTop = 4;
    tag.paddingBottom = 4;
    tag.cornerRadius = Math.min(numberOf('radius/pill', 9999), 999);

    tag.fills = [colorPaintOf(tagBgKey)];
    if (tagBorderKey) {
      tag.strokes = [colorPaintOf(tagBorderKey)];
      tag.strokeWeight = 1;
      try {
        tag.strokeAlign = 'INSIDE';
      } catch (err) {
        /* 忽略 */
      }
    }
    tryBind(tag, 'cornerRadius', 'radius/pill');

    const text = createTextNode(label, tagTextKey, 12, state.fonts.regular);
    tag.appendChild(text);
    return tag;
  }

  /** 单个 FeedCard 变体 */
  function createCardComponent(stateName, buttonSet) {
    const style = CARD_STYLE[stateName];
    const textKeys = CARD_TEXT[stateName] || CARD_TEXT.Default;

    const card = figma.createComponent();
    card.name = 'State=' + stateName;
    card.fills = [];
    card.strokes = [];

    // 纵向 auto layout，宽 560，内边距 20
    card.layoutMode = 'VERTICAL';
    card.primaryAxisSizingMode = 'AUTO';
    card.counterAxisSizingMode = 'FIXED';
    card.itemSpacing = numberOf('space/stack-md', 12);
    const padding = numberOf('space/card-padding', 20);
    card.paddingTop = padding;
    card.paddingBottom = padding;
    card.paddingLeft = padding;
    card.paddingRight = padding;
    card.cornerRadius = numberOf('radius/surface', 16);

    try {
      card.resize(CARD_WIDTH, 320);
    } catch (err) {
      log('设置卡片宽度失败（不影响结构）：' + err.message, 'warn');
    }

    // 背景 / 描边 / 阴影
    card.fills = [colorPaintOf(style.fill)];
    card.strokes = [colorPaintOf(style.border)];
    card.strokeWeight = 1;
    try {
      card.strokeAlign = 'INSIDE';
    } catch (err) {
      /* 忽略 */
    }

    if (style.shadow) {
      const effects = parseShadowEffects(literalOf(style.shadow));
      if (effects.length) {
        card.effects = effects;
      } else {
        // 兜底：手动近似 --shadow-card
        card.effects = [
          {
            type: 'DROP_SHADOW',
            color: { r: 0.06, g: 0.09, b: 0.16, a: 0.1 },
            offset: { x: 0, y: 8 },
            radius: 24,
            spread: -12,
            visible: true,
            blendMode: 'NORMAL',
          },
        ];
        log('shadow token 无法解析，已用近似阴影：' + style.shadow, 'warn');
      }
    } else {
      card.effects = []; // Disabled：无阴影
    }

    tryBind(card, 'paddingLeft', 'space/card-padding');
    tryBind(card, 'paddingRight', 'space/card-padding');
    tryBind(card, 'paddingTop', 'space/card-padding');
    tryBind(card, 'paddingBottom', 'space/card-padding');
    tryBind(card, 'itemSpacing', 'space/stack-md');
    tryBind(card, 'cornerRadius', 'radius/surface');

    /* ---------- 头部：头像 + 作者/时间 + 更多 ---------- */
    const header = createPlainFrame('header', 'HORIZONTAL', numberOf('space/stack-md', 12));
    header.primaryAxisAlignItems = 'SPACE_BETWEEN';
    header.counterAxisAlignItems = 'CENTER';
    card.appendChild(header);
    fillWidth(header);

    const headerLeft = createPlainFrame('header-left', 'HORIZONTAL', numberOf('space/stack-md', 12));
    headerLeft.counterAxisAlignItems = 'CENTER';
    header.appendChild(headerLeft);

    const avatar = figma.createEllipse();
    avatar.name = 'avatar';
    const avatarSize = numberOf('size/avatar', 40);
    avatar.resize(avatarSize, avatarSize);
    avatar.fills = [
      colorPaintOf(stateName === 'Disabled' ? 'color/disabled/border' : 'color/brand/muted'),
    ];
    headerLeft.appendChild(avatar);

    const meta = createPlainFrame('meta', 'VERTICAL', numberOf('space/stack-xs', 4));
    headerLeft.appendChild(meta);

    const author = createTextNode(
      'Alex Chen',
      textKeys.meta,
      numberOf('font/size/meta', 14),
      state.fonts.semibold
    );
    meta.appendChild(author);
    tryBind(author, 'fontWeight', 'font/weight/semibold');

    const time = createTextNode(
      '2h ago',
      textKeys.time,
      numberOf('type/size/xs', 12),
      state.fonts.regular
    );
    meta.appendChild(time);

    const more = createTextNode('···', textKeys.time, 16, state.fonts.regular);
    header.appendChild(more);

    /* ---------- 标题 / 正文 ---------- */
    const title = createTextNode(
      'Feed card title',
      textKeys.title,
      numberOf('font/size/title', 18),
      state.fonts.semibold
    );
    card.appendChild(title);
    try {
      title.textAutoResize = 'HEIGHT'; // 允许横向 FILL 之后按宽度换行
    } catch (err) {
      /* 忽略 */
    }
    fillWidth(title);
    tryBind(title, 'fontWeight', 'font/weight/semibold');

    const body = createTextNode(
      CARD_BODY,
      textKeys.body,
      numberOf('font/size/body', 16),
      state.fonts.regular
    );
    card.appendChild(body);
    try {
      body.textAutoResize = 'HEIGHT';
    } catch (err) {
      /* 忽略 */
    }
    fillWidth(body);
    try {
      const leading = numberOf('font/leading/body', 1.5);
      body.lineHeight = { unit: 'PERCENT', value: Math.round(leading * 100) };
    } catch (err) {
      /* lineHeight 赋值失败不影响内容 */
    }

    /* ---------- 标签行 ---------- */
    const tagRow = createPlainFrame('tags', 'HORIZONTAL', numberOf('space/stack-sm', 8));
    card.appendChild(tagRow);
    tagRow.appendChild(createTag('Design Tokens', textKeys.tagBg, textKeys.tagText, null));
    tagRow.appendChild(createTag('Figma', textKeys.tagBg, textKeys.tagText, null));

    /* ---------- 底部按钮行：两个 ghost + 一个 primary ---------- */
    const footer = createPlainFrame('footer', 'HORIZONTAL', numberOf('space/stack-sm', 8));
    footer.primaryAxisAlignItems = 'MAX';
    footer.counterAxisAlignItems = 'CENTER';
    card.appendChild(footer);
    fillWidth(footer);

    if (buttonSet && buttonSet.byKey.size) {
      const ghostKey = stateName === 'Disabled' ? 'Ghost/Disabled' : 'Ghost/Default';
      const primaryKey = stateName === 'Disabled' ? 'Primary/Disabled' : 'Primary/Default';
      addButtonInstance(footer, buttonSet.byKey.get(ghostKey), 'Read more');
      addButtonInstance(footer, buttonSet.byKey.get(ghostKey), 'Save');
      addButtonInstance(footer, buttonSet.byKey.get(primaryKey), 'Follow');
    } else {
      // Button 没生成成功时用文字占位，保证卡片结构仍然完整
      const placeholder = createTextNode('Button / Button', textKeys.time, 14, state.fonts.regular);
      footer.appendChild(placeholder);
      log('Button 组件不可用，FeedCard 底部已用文字占位（' + stateName + '）', 'warn');
    }

    return card;
  }

  /** 生成 4 个 FeedCard 组件并合并成组件集 */
  function buildCardSet(buttonSet) {
    const components = [];
    for (const stateName of CARD_STATES) {
      try {
        components.push(createCardComponent(stateName, buttonSet));
      } catch (err) {
        log('创建 FeedCard ' + stateName + ' 失败：' + err.message, 'error');
      }
    }

    let set = null;
    if (components.length) {
      try {
        set = figma.combineAsVariants(components, figma.currentPage);
        set.name = 'FeedCard';
        log('FeedCard 组件集已生成：' + components.length + ' 个状态', 'success');
      } catch (err) {
        log('合并 FeedCard 变体失败（组件仍然各自保留在画布上）：' + err.message, 'error');
      }
    }
    return { set: set, count: components.length };
  }

  /** 组件总入口 */
  async function buildComponents() {
    state.fonts = await pickFonts();
    if (!state.fonts) {
      log('没有可用字体，跳过组件生成（变量已经创建完成，可先用变量面板核对）。', 'error');
      return { buttons: 0, cards: 0, buttonSet: null, cardSet: null };
    }

    const buttonSet = buildButtonSet();
    const cardSet = buildCardSet(buttonSet);

    try {
      if (buttonSet.set) {
        buttonSet.set.x = 0;
        buttonSet.set.y = 0;
      }
      if (cardSet.set) {
        cardSet.set.x = 0;
        cardSet.set.y = buttonSet.set ? buttonSet.set.height + 120 : 0;
      }
    } catch (err) {
      log('摆放组件集位置失败（可以手动拖）：' + err.message, 'warn');
    }

    const focus = [buttonSet.set, cardSet.set].filter(Boolean);
    if (focus.length) {
      try {
        figma.viewport.scrollAndZoomIntoView(focus);
      } catch (err) {
        log('缩放到组件失败（可以手动找）：' + err.message, 'warn');
      }
    }

    return {
      buttons: buttonSet.count,
      cards: cardSet.count,
      buttonSet: buttonSet.set,
      cardSet: cardSet.set,
    };
  }

  /* ============================================================
   * 8. 导出：Figma 变量 -> Tokens Studio 兼容 JSON
   * ============================================================ */

  /** resolvedType + 变量名 -> Tokens Studio 的 type（导出后仍需人工确认，见文档） */
  function inferTokenType(name, resolvedType) {
    const parts = name.split('/');
    const first = parts[0];
    const second = parts[1] || '';

    if (resolvedType === 'COLOR') return 'color';

    if (resolvedType === 'FLOAT') {
      if (first === 'radius') return 'borderRadius';
      if (first === 'shadow') return 'boxShadow';
      if (first === 'duration') return 'duration';
      // motion/duration、motion/duration-fast 都算时长（时间单位是 ms）
      if (first === 'motion' && second !== 'easing') return 'duration';
      if ((first === 'type' || first === 'font') && second === 'size') return 'fontSizes';
      if ((first === 'type' || first === 'font') && second === 'weight') return 'fontWeights';
      if ((first === 'type' || first === 'font') && second === 'leading') return 'lineHeights';
      if (first === 'space') return 'spacing';
      if (first === 'size') return 'sizing';
      return 'number';
    }

    if (resolvedType === 'STRING') {
      if (first === 'shadow') return 'boxShadow';
      if (first === 'typeface' || (first === 'font' && second === 'family')) return 'fontFamilies';
      if (first === 'easing' || (first === 'motion' && second === 'easing')) return 'cubicBezier';
      return 'other';
    }

    return 'other';
  }

  /** 变量值 -> JSON 里的值（别名还原成 {引用}） */
  function serializeValue(raw, resolvedType, variablesById) {
    if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
      const target = variablesById.get(raw.id);
      if (!target) return null;
      return '{' + target.name.split('/').join('.') + '}';
    }
    if (resolvedType === 'COLOR') return colorToCss(raw);
    if (resolvedType === 'FLOAT') {
      const num = Number(raw);
      return Number.isFinite(num) ? round3(num) : null;
    }
    if (resolvedType === 'STRING') return typeof raw === 'string' ? raw : String(raw);
    if (resolvedType === 'BOOLEAN') return Boolean(raw);
    return null;
  }

  /** 两个模式的值是否"看起来一样"（用来决定 dark 里要不要写这个 token） */
  function sameValue(a, b) {
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      if (a.type === 'VARIABLE_ALIAS' || b.type === 'VARIABLE_ALIAS') return a.id === b.id;
      if (typeof a.r === 'number' && typeof b.r === 'number') {
        return ['r', 'g', 'b', 'a'].every(
          (channel) => Math.abs(Number(a[channel] || 0) - Number(b[channel] || 0)) < 0.001
        );
      }
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return a === b;
  }

  /** 往嵌套对象里写值；遇到"同名既当分组又当 token"的冲突就跳过 */
  function setDeep(target, path, value) {
    let cursor = target;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index];
      if (!cursor[key] || typeof cursor[key] !== 'object' || hasOwn(cursor[key], 'value')) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    const last = path[path.length - 1];
    if (hasOwn(cursor, last)) return false;
    cursor[last] = value;
    return true;
  }

  /** 从集合 pluginData 里读回"哪些变量来自 core"；读不到返回 null */
  function readCoreKeys(collection) {
    try {
      const raw = collection.getPluginData(CORE_KEYS_PLUGIN_DATA);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return new Set(parsed);
    } catch (err) {
      log('读取 core 变量清单失败（导出会把全部变量放在 semantic）：' + err.message, 'warn');
    }
    return null;
  }

  /** 插件数据丢了就退回"本次会话导入过什么" */
  function coreKeysFromSession() {
    const keys = new Set();
    for (const entry of state.entries.values()) {
      if (entry.set === 'core') keys.add(entry.key);
    }
    return keys.size ? keys : null;
  }

  /** 递归数一棵 token 树里有多少个 token（有 value 字段的节点） */
  function countTokens(node) {
    if (!node || typeof node !== 'object') return 0;
    if (Object.prototype.hasOwnProperty.call(node, 'value')) return 1;
    let total = 0;
    for (const key of Object.keys(node)) total += countTokens(node[key]);
    return total;
  }

  async function exportVariables() {
    if (!figma.variables) {
      throw new Error('当前 Figma 版本没有 Variables API，请把桌面版升级到最新。');
    }

    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const targets = collections.filter(
      (collection) =>
        typeof collection.name === 'string' && collection.name.indexOf(COLLECTION_NAME) === 0
    );
    if (!targets.length) {
      throw new Error(
        '当前文件里没有名字以 "' + COLLECTION_NAME + '" 开头的变量集合。请先点“① 生成变量与组件”。'
      );
    }

    let allVariables = [];
    try {
      allVariables = await figma.variables.getLocalVariablesAsync();
    } catch (err) {
      throw new Error('读取本地变量失败：' + err.message);
    }
    const variablesById = new Map();
    for (const variable of allVariables) variablesById.set(variable.id, variable);

    // core 先写，保证导出文件里 set 的顺序是 core / semantic / dark（和源文件一致，diff 更好读）
    const output = { core: {}, semantic: {}, dark: {} };
    let exported = 0;
    let coreCount = 0;
    let darkOverrides = 0;
    let skipped = 0;
    let sawDarkMode = false;

    for (const collection of targets) {
      const modes = collection.modes || [];
      if (!modes.length) continue;
      const lightModeId = modes[0].modeId;
      const darkMode = modes.find((mode) => String(mode.name).toLowerCase() === 'dark');
      const darkModeId = darkMode ? darkMode.modeId : null;
      if (darkModeId) sawDarkMode = true;
      const coreKeys = readCoreKeys(collection) || coreKeysFromSession();
      if (!coreKeys) {
        log(
          '没找到"哪些变量来自 core"的记录（可能变量不是本插件导入的）：导出时全部放进 semantic，' +
            '并保留一个空的 core 占位，保证 build-tokens.mjs 能跑。',
          'warn'
        );
      }

      for (const variable of allVariables) {
        if (variable.variableCollectionId !== collection.id) continue;
        const path = variable.name.split('/').filter(Boolean);
        if (!path.length) continue;

        const type = inferTokenType(variable.name, variable.resolvedType);
        const lightRaw = variable.valuesByMode[lightModeId];
        if (lightRaw === undefined) {
          skipped += 1;
          continue;
        }
        const lightValue = serializeValue(lightRaw, variable.resolvedType, variablesById);
        if (lightValue === null) {
          skipped += 1;
          log('导出时跳过 ' + variable.name + '：值类型暂不支持（' + variable.resolvedType + '）', 'warn');
          continue;
        }
        const isCore = Boolean(coreKeys && coreKeys.has(variable.name));
        const targetSet = isCore ? output.core : output.semantic;
        if (!setDeep(targetSet, path, { value: lightValue, type: type })) {
          skipped += 1;
          log('导出时跳过 ' + variable.name + '：与已有分组同名冲突', 'warn');
          continue;
        }
        if (isCore) coreCount += 1;
        exported += 1;

        if (darkModeId) {
          const darkRaw = variable.valuesByMode[darkModeId];
          if (darkRaw !== undefined && !sameValue(lightRaw, darkRaw)) {
            const darkValue = serializeValue(darkRaw, variable.resolvedType, variablesById);
            if (darkValue !== null) {
              if (setDeep(output.dark, path, { value: darkValue, type: type })) darkOverrides += 1;
            }
          }
        }
      }
    }

    if (!exported) throw new Error('集合里没有可导出的变量（值都是空的？）。');
    // 故意保留空的 core / dark：build-tokens.mjs 要求这两个 set 必须存在，
    // 没有暗色模式时 dark 会是空对象（见下面的提醒）。
    if (!sawDarkMode) {
      let restoredDark = null;
      try {
        const cached = figma.root.getPluginData(LAST_DARK_PLUGIN_DATA);
        if (cached) restoredDark = JSON.parse(cached);
      } catch (err) {
        restoredDark = null;
      }
      const restoredCount = restoredDark ? countTokens(restoredDark) : 0;

      if (restoredCount > 0) {
        // 单模式（免费版）下，用本文件上次导入的 dark 段补齐导出结果，
        // 这样用户可以直接覆盖 tokens.json，不会丢掉暗色主题。
        output.dark = restoredDark;
        darkOverrides = restoredCount;
        log(
          '当前变量集合只有 1 个模式（Figma 免费版限制）：已从本文件「上次导入的 tokens.json」' +
            '自动恢复 dark 段（' +
            restoredCount +
            ' 个 token），导出结果可以安全覆盖 tokens.json。',
          'success'
        );
      } else {
        log(
          '注意：当前变量集合只有 1 个模式，且没有上次导入的 dark 记录，导出结果里的 dark 是空的 —— ' +
            '直接覆盖 tokens.json 会丢掉暗色主题。请只手动合并改动的值，' +
            '或见 docs/04-Figma同步.md 的「免费版怎么安全回写」。',
          'warn'
        );
      }
    }

    const json = JSON.stringify(output, null, 2);
    log(
      '导出完成：' +
        exported +
        ' 个变量（core ' +
        coreCount +
        ' 个，semantic ' +
        (exported - coreCount) +
        ' 个），Dark 覆盖 ' +
        darkOverrides +
        ' 个；跳过 ' +
        skipped +
        ' 个。',
      'success'
    );
    return {
      json: json,
      stats: {
        collections: targets.length,
        variables: exported,
        core: coreCount,
        semantic: exported - coreCount,
        darkOverrides: darkOverrides,
        skipped: skipped,
        hasDark: darkOverrides > 0,
      },
    };
  }

  /* ============================================================
   * 9. 消息处理
   * ============================================================ */

  async function handleImport(payload) {
    if (!figma.variables) {
      throw new Error(
        '当前 Figma 版本没有 Variables API（figma.variables）。请在 Figma 桌面版里更新到最新版本后再试。'
      );
    }

    let parsed = null;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      throw new Error('tokens.json 解析失败：' + err.message + '（检查是否少粘贴了结尾的 }）');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('tokens.json 顶层必须是一个对象（形如 { "core": ..., "semantic": ... }）');
    }
    const known = SET_ORDER.filter((name) => parsed[name] && typeof parsed[name] === 'object');
    if (!known.length) {
      throw new Error('没找到 core / semantic / dark 任何一个 set，请确认粘贴的是 tokens/tokens.json。');
    }

    // 记下本次导入的 dark 段：Figma 免费版没有多模式，导出时用它把 dark 补回来，
    // 避免用户整文件覆盖 tokens.json 时静默丢掉暗色主题。
    try {
      const darkSet = parsed.dark && typeof parsed.dark === 'object' ? parsed.dark : null;
      if (darkSet && Object.keys(darkSet).length) {
        figma.root.setPluginData(LAST_DARK_PLUGIN_DATA, JSON.stringify(darkSet));
      }
    } catch (err) {
      log('记录 dark 段失败（免费版导出时将无法自动恢复暗色）：' + err.message, 'warn');
    }

    // 重置状态：重复运行不会串数据
    state.tokens = parsed;
    state.entries = new Map();
    state.vars = new Map();
    state.fonts = null;

    const collected = collectEntries(parsed);
    for (const warning of collected.warnings) log(warning, 'warn');
    if (!collected.map.size) {
      throw new Error('没有解析到任何 token：检查 JSON 里每个 token 是否有 "value" 字段。');
    }

    let coreCount = 0;
    let darkCount = 0;
    for (const entry of collected.map.values()) {
      if (entry.set === 'core') coreCount += 1;
      if (entry.darkToken) darkCount += 1;
    }
    log(
      '解析成功：' +
        collected.map.size +
        ' 个变量（core ' +
        coreCount +
        ' 个，暗色覆盖 ' +
        darkCount +
        ' 个），set：' +
        known.join(' / ')
    );

    state.entries = collected.map;
    const variableStats = await createVariables(collected.map);

    let componentStats = { buttons: 0, cards: 0 };
    try {
      componentStats = await buildComponents();
    } catch (err) {
      log('组件生成整体失败（变量已创建，可继续用变量）：' + err.message, 'error');
    }

    try {
      figma.notify(
        '完成：' +
          variableStats.created +
          ' 个新变量，Button ' +
          componentStats.buttons +
          ' 个变体，FeedCard ' +
          componentStats.cards +
          ' 个状态'
      );
    } catch (err) {
      /* 忽略 */
    }

    return {
      variables: variableStats,
      components: { buttons: componentStats.buttons, cards: componentStats.cards },
      dark: variableStats.dark,
    };
  }

  /* ============================================================
   * 10. 启动：显示 UI、挂消息监听
   * ============================================================ */

  figma.showUI(__html__, { width: 560, height: 740, title: 'DSL Token Bridge' });

  figma.ui.onmessage = async (message) => {
    if (!message || !message.type) return;

    if (message.type === 'import') {
      try {
        const stats = await handleImport(String(message.payload || ''));
        figma.ui.postMessage({ type: 'import-done', stats: stats });
      } catch (err) {
        const text = err && err.message ? err.message : String(err);
        // 控制台留一份，UI 只显示一次（UI 收到 error 消息会写日志，避免重复）
        console.error('[错误] ' + text);
        figma.ui.postMessage({ type: 'error', scope: 'import', message: text });
        try {
          figma.notify('导入失败：' + text, { error: true });
        } catch (notifyErr) {
          /* 忽略 */
        }
      }
      return;
    }

    if (message.type === 'export') {
      try {
        const result = await exportVariables();
        figma.ui.postMessage({ type: 'export-result', json: result.json, stats: result.stats });
      } catch (err) {
        const text = err && err.message ? err.message : String(err);
        console.error('[错误] ' + text);
        figma.ui.postMessage({ type: 'error', scope: 'export', message: text });
        try {
          figma.notify('导出失败：' + text, { error: true });
        } catch (notifyErr) {
          /* 忽略 */
        }
      }
      return;
    }
  };
})();
