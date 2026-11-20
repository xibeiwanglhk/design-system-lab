/**
 * build-tokens.mjs —— 设计令牌编译器（零依赖）
 * =====================================================
 * 输入：tokens/tokens.json（唯一真源，Tokens Studio 兼容格式）
 * 输出：src/styles/tokens.css（CSS 自定义属性）
 *
 * 用法：
 *   node scripts/build-tokens.mjs            # 生成 tokens.css
 *   node scripts/build-tokens.mjs --check    # 只校验，若文件过期则退出码 1（给 CI 用）
 *
 * 命名规则（非常重要，Figma 与 CSS 靠这条规则对齐）：
 *   token 的完整路径 = [set 名, 分组..., token 名]
 *   CSS 变量名 = 去掉最外层 set 名，剩余路径用 "-" 连接，前面加 "--"
 *   例：semantic.color.bg.surface-hover  ->  --color-bg-surface-hover
 *       core.font.size.md               ->  --font-size-md
 *   在 Figma 中，变量名 = 去掉 set 名后的路径用 "/" 连接：
 *       semantic.color.bg.surface-hover  ->  color/bg/surface-hover
 *   所以：Figma 变量名 color/bg/surface-hover  <=>  CSS --color-bg-surface-hover
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOKENS_FILE = path.join(ROOT, 'tokens', 'tokens.json');
const STYLES_DIR = path.join(ROOT, 'src', 'styles');
const OUT_FILE = path.join(STYLES_DIR, 'tokens.css');

/** 主题覆盖集：这些 set 会输出到 [data-theme="dark"] 里 */
const DARK_SETS = new Set(['dark']);
/** 基础集：输出到 :root 里（按此顺序合并，后面的覆盖前面的） */
const BASE_SETS = ['core', 'semantic'];
/** 引用解析时，按这个顺序在所有 set 中查找 */
const LOOKUP_ORDER = ['core', 'semantic', 'dark'];

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');

// ---------------------------------------------------------------- 读取 JSON
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`\n❌ 无法读取或解析 ${path.relative(ROOT, file)}：${err.message}\n`);
    process.exit(1);
  }
};

const tokens = readJson(TOKENS_FILE);
const setNames = Object.keys(tokens);

// ---------------------------------------------------------------- 展平 token
/**
 * 把嵌套的 token 树展平成数组：
 * { set, path: ['color','bg','canvas'], token: { value, type } }
 * 判断规则：对象里有 value 字段就是 token，否则是分组。
 */
function flatten(setName, node, prefix = [], out = []) {
  if (node === null || typeof node !== 'object') {
    throw new Error(`token "${setName}.${prefix.join('.')}" 不是对象`);
  }
  if (Object.prototype.hasOwnProperty.call(node, 'value')) {
    out.push({ set: setName, path: prefix, token: node });
    return out;
  }
  for (const [key, child] of Object.entries(node)) {
    flatten(setName, child, [...prefix, key], out);
  }
  return out;
}

const all = [];
for (const setName of setNames) {
  flatten(setName, tokens[setName], [], all);
}

// ---------------------------------------------------------------- 引用解析
const resolveCache = new Map();

function findToken(pathSegments) {
  // 1) 以完整路径从根节点查找（允许引用里写 set 名，例如 {core.color.gray.50}）
  let cur = tokens;
  let ok = true;
  for (const seg of pathSegments) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) {
      cur = cur[seg];
    } else {
      ok = false;
      break;
    }
  }
  if (ok && cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, 'value')) {
    return cur;
  }
  // 2) 省略 set 前缀时（Tokens Studio 的常见写法），按 LOOKUP_ORDER 到各 set 里找
  for (const setName of LOOKUP_ORDER) {
    if (!tokens[setName]) continue;
    let node = tokens[setName];
    let found = true;
    for (const seg of pathSegments) {
      if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, seg)) {
        node = node[seg];
      } else {
        found = false;
        break;
      }
    }
    if (found && node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, 'value')) {
      return node;
    }
  }
  return null;
}

const REF_RE = /^\{([^{}]+)\}$/;
const refProblems = [];

/** 解析 token 值里的 {引用}，返回最终字符串/数值（带缓存，检测循环引用） */
function resolveValue(token, chain = []) {
  const cacheKey = chain.length ? null : token; // 只缓存顶层调用
  if (cacheKey && resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);

  const raw = token.value;
  if (typeof raw !== 'string') return raw;

  const match = raw.match(REF_RE);
  if (!match) return raw;

  const refPath = match[1].trim().split('.').map((s) => s.trim()).filter(Boolean);
  const key = refPath.join('.');
  if (chain.includes(key)) {
    refProblems.push(`检测到循环引用：${[...chain, key].join(' -> ')}`);
    return `{${key}}`;
  }

  const target = findToken(refPath);
  if (!target) {
    refProblems.push(`找不到引用目标 {${key}}`);
    return `{${key}}`;
  }
  const value = resolveValue(target, [...chain, key]);
  if (cacheKey) resolveCache.set(cacheKey, value);
  return value;
}

// ---------------------------------------------------------------- 类型 -> CSS 单位
const UNIT_BY_TYPE = {
  spacing: 'px',
  sizing: 'px',
  borderRadius: 'px',
  fontSizes: 'px',
  borderWidth: 'px',
  letterSpacing: 'px',
  paragraphSpacing: 'px',
  duration: 'ms',
};

/** 把解析后的值转成 CSS 字面量 */
function toCssValue(token, value) {
  const type = token.type;
  if (typeof value === 'number') {
    const unit = UNIT_BY_TYPE[type];
    if (unit === 'px' && value === 0) return '0';
    return unit ? `${value}${unit}` : String(value);
  }
  // lineHeights 允许 "150%" 这种字符串；color/boxShadow/cubicBezier 等直接透传
  return String(value);
}

// ---------------------------------------------------------------- CSS 变量名
const kebab = (segment) =>
  String(segment)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();

function cssVarName(pathSegments) {
  // pathSegments 里不包含 set 名，所以直接拼接即为 CSS 变量名
  return `--${pathSegments.map(kebab).join('-')}`;
}

// ---------------------------------------------------------------- 生成 CSS
const errors = [];
const warnings = [];

function buildBlock(setList, blockLabel) {
  const lines = [];
  const seen = new Map();
  for (const setName of setList) {
    if (!tokens[setName]) {
      errors.push(`tokens.json 里不存在 set "${setName}"`);
      continue;
    }
    lines.push(`  /* ===== ${setName} ===== */`);
    const groupTokens = all.filter((t) => t.set === setName);
    for (const item of groupTokens) {
      const name = cssVarName(item.path);
      const value = toCssValue(item.token, resolveValue(item.token));
      if (seen.has(name)) {
        errors.push(
          `CSS 变量重名：${name}（${seen.get(name)} 与 ${setName}.${item.path.join('.')}）`
        );
        continue;
      }
      seen.set(name, `${setName}.${item.path.join('.')}`);
      lines.push(`  ${name}: ${value};`);
    }
    lines.push('');
  }
  if (blockLabel === 'dark') {
    lines.push('  color-scheme: dark;');
  } else {
    lines.push('  color-scheme: light;');
  }
  return lines.join('\n');
}

const baseBlock = buildBlock(BASE_SETS, 'base');
const darkBlock = buildBlock([...DARK_SETS], 'dark');

// 引用解析错误是在 buildBlock（内部调用 resolveValue）执行时才收集到的，
// 所以必须放在两个 block 生成之后再并入 errors，否则「坏引用/循环引用」会被静默忽略。
for (const problem of new Set(refProblems)) {
  errors.push(problem);
}

// 暗色集合为空是"能用但有坑"的状态：编译不会报错，但暗色主题完全没有覆盖。
// 最常见的原因是 Figma 免费版只支持单模式，导出后没有把 dark 段合并回 tokens.json（见 docs/04 的 2.18）。
const darkTokenCount = all.filter((t) => DARK_SETS.has(t.set)).length;
if (darkTokenCount === 0) {
  warnings.push(
    'dark 集合为空：暗色主题不会有任何覆盖。若刚用 Figma 免费版导出过变量，请按 docs/04 的「免费版怎么安全回写」把 dark 段补回来。'
  );
}

// 暗色覆盖必须是 :root 里已有变量的子集，否则暗色下会引用到不存在的变量
const baseVars = new Set(
  all.filter((t) => BASE_SETS.includes(t.set)).map((t) => cssVarName(t.path))
);
for (const item of all.filter((t) => DARK_SETS.has(t.set))) {
  const name = cssVarName(item.path);
  if (!baseVars.has(name)) {
    errors.push(`暗色 token ${item.set}.${item.path.join('.')} 在基础集中没有同路径 token（${name}）`);
  }
}

const header = `/* =====================================================================
 * 自动生成文件，请勿手动修改！
 * 源文件：tokens/tokens.json      生成命令：node scripts/build-tokens.mjs
 * 生成规则：token 路径去掉最外层 set 名，用 "-" 连接，前面加 "--"
 *           Figma 变量名 = 同一路径用 "/" 连接（color/bg/canvas <=> --color-bg-canvas）
 * 主题：默认 = :root；暗色 = [data-theme="dark"]（由 index.html 切换）
 * ===================================================================== */
`;

const css = `${header}
:root {
${baseBlock}
}

[data-theme="dark"] {
${darkBlock}
}
`;

// ---------------------------------------------------------------- 校验组件用到的变量
const defined = new Set(
  all.map((t) => cssVarName(t.path))
);

function walkFiles(dir, extList = ['.css', '.html'], out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, extList, out);
    else if (extList.includes(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

const usage = new Map(); // varName -> Set(file)
for (const file of walkFiles(path.join(ROOT, 'src'))) {
  if (path.resolve(file) === path.resolve(OUT_FILE)) continue;
  const content = fs.readFileSync(file, 'utf8');
  const re = /var\(\s*(--[A-Za-z0-9_-]+)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    if (name.startsWith('--_')) continue; // --_ 开头：组件内部的私有变量，不参与校验
    if (!usage.has(name)) usage.set(name, new Set());
    usage.get(name).add(path.relative(ROOT, file));
  }
}
for (const [name, files] of usage) {
  if (!defined.has(name)) {
    errors.push(`组件使用了未定义的 token 变量 ${name}（出现在 ${[...files].join('、')}）`);
  }
}
const unused = [...defined].filter((name) => !usage.has(name));
if (unused.length) {
  warnings.push(`有 ${unused.length} 个 token 变量没有被 src/ 里的样式或页面使用（正常，属于预留令牌）`);
}

// ---------------------------------------------------------------- 输出 / 校验
const relativeOut = path.relative(ROOT, OUT_FILE);
const oldCss = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;
const changed = oldCss !== css;

if (errors.length) {
  console.error('\n❌ 令牌编译失败：');
  for (const err of errors) console.error(`   - ${err}`);
  console.error('');
  process.exit(1);
}

if (CHECK_ONLY) {
  if (changed) {
    console.error(`\n❌ ${relativeOut} 已过期，请运行：npm run tokens\n`);
    process.exit(1);
  }
  console.log(`\n✅ 令牌校验通过：${defined.size} 个 CSS 变量，${usage.size} 个被组件使用。\n`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, css, 'utf8');

const tokenCount = all.length;
const countBySet = setNames.map((s) => `${s} ${all.filter((t) => t.set === s).length}`).join(' / ');
console.log(`\n✅ 已生成 ${relativeOut}`);
console.log(`   token 总数：${tokenCount}（${countBySet}）`);
console.log(`   CSS 变量：${defined.size} 个；被组件使用：${usage.size} 个`);
if (changed) console.log('   本次内容有变化，记得提交 tokens.json 和 tokens.css');
for (const w of warnings) console.log(`   ⚠️  ${w}`);
console.log('');
