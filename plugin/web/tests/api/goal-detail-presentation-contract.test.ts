import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Goal（25 号）详情呈现契约。
 *
 * Goal 是单例冻结锚：单例三免（免 tab 免 card 免候选召回，25 §5）——不占
 * 七类事实对象的导航与列表；详情阅读面经 /api/cognition/goal 直读路由
 * 承载（25 §10 消费点直读），修订史（change_log）进认知中心近期动态。
 */

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('goal detail route projects the full reading surface from a shared reader', () => {
  const cognition = read('api/routes/cognition.ts');

  // /goal 与近期动态共用 readGoalRecord（单例读取唯一实现）。
  assert.match(cognition, /async function readGoalRecord\(project: \{ path: string \}\)/);
  // 详情投影扩展：修订史 + 创建时间 + exact-read 形态的读取层元数据
  //（canonical_path/carrier/read_status 供前端 getFactReadMeta 消费）。
  assert.match(cognition, /created_at: typeof meta\.created_at === 'string' \? meta\.created_at : undefined,/);
  assert.match(cognition, /change_log: Array\.isArray\(meta\.change_log\) \? meta\.change_log : \[\],/);
  assert.match(cognition, /canonical_path: 'ldvh-base\/goal\.md',/);
  // 呈现层轻校验：25 §6 必填闭集 + goal_key 固定值 identity。
  assert.match(cognition, /GOAL_REQUIRED_FIELDS = \['goal_key', 'title', 'status', 'created_at'\] as const/);
  assert.match(cognition, /reason: 'identity_mismatch', expected: 'project-goal'/);
});

test('recent activity includes the singleton goal change-log stream', () => {
  const cognition = read('api/routes/cognition.ts');

  // 类型面放宽：RecentActivityBuildItem 接受 'goal'（非 ACTIVE_OBJECT_TYPES 多例）。
  assert.match(cognition, /type: ObjectType \| 'goal'/);
  // 主路由追加 goal 条目：goal.md 未创建是合法状态（静默跳过），不可读如实披露。
  assert.match(cognition, /const goalRecord = await readGoalRecord\(project\)/);
  assert.match(cognition, /\{\s*\.\.\.goalRecord\.raw,\s*\n\s*object_id: 'goal',[\s\S]*?\n\s*'goal',\s*\n\s*recentStart,/);
  assert.match(cognition, /code: 'goal_unreadable'/);
  // 读取层判定随条目携带：readable 注入防止展示层回退 'unknown' 误报；
  // 轻校验 field_issues 如实带入（goal.md 字段问题可见）。
  assert.match(cognition, /read_status: 'readable',\s*\n\s*field_issues: goalRecord\.fieldIssues,/);
  // 近期动态测试的类型白名单同步纳入 goal。
  const test = read('tests/api/cognition-inbox-contract.test.ts');
  assert.match(test, /\['workcase', 'adr', 'pitfall', 'spark', 'research', 'goal'\]\.includes/);
});

test('goal registers type semantics: label, status closure, icon, colors', () => {
  const locales = read('src/i18n/locales.ts');
  const icons = read('src/components/SemanticIcon.tsx');
  const colors = read('src/utils/categoryColors.ts');
  const statusColors = read('src/utils/statusColors.ts');
  const typeColors = read('api/services/typeColors.ts');

  assert.match(locales, /goal: \{ zh: '目标', en: 'Goal' \}/);
  // 25 §7 状态闭集：active/achieved。
  assert.match(locales, /goal: \{\s*\n\s*\/\/ 25 号 §7[\s\S]*?active: \{ zh: '生效中', en: 'Active' \},[\s\S]*?achieved: \{ zh: '已达成', en: 'Achieved' \},/);
  assert.match(locales, /goal_statement: \{ zh: '目标陈述', en: 'Goal Statement' \}/);
  assert.match(locales, /goal_sub_goals: \{ zh: '子目标', en: 'Sub-goals' \}/);
  assert.match(icons, /goal: Target,/);
  assert.match(colors, /goal: '#10b981'/);
  assert.match(statusColors, /achieved: \{ light: '#059669', dark: '#00d4aa' \}/);
  assert.match(typeColors, /goal: '#10b981'/);
});

test('goal detail page routes through the shared reading layout', () => {
  const app = read('src/App.tsx');
  const goalDetail = read('src/pages/GoalDetail.tsx');
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');

  // /goal 路由（单例无 :id）。
  assert.match(app, /<Route path="\/goal" element=\{<GoalDetail \/>\} \/>/);
  // 复用 ObjectIdentityHeader + FactReadingContent（与七类对象同一设计语言）。
  assert.match(goalDetail, /import \{ ObjectIdentityHeader, FactReadingContent, getAuxiliaryMetaEntries \} from '@\/pages\/ObjectDetail';/);
  assert.match(goalDetail, /objType="goal"/);
  assert.match(objectDetail, /objType === 'goal' \? \(\s*\n\s*<GoalReadingLayout obj=\{obj\} locale=\{locale\} \/>/);
  // 阅读布局：目标陈述 → 子目标（SG-n chip）→ 修订史（复用 ChangeLogReadingNode）。
  assert.match(layouts, /export function GoalReadingLayout/);
  assert.match(layouts, /getFieldLabel\('goal_statement', locale\)/);
  assert.match(layouts, /getFieldLabel\('goal_sub_goals', locale\)/);
  assert.match(layouts, /function GoalReadingLayout[\s\S]*?<ChangeLogReadingNode/);
});

test('secondary reading panel resolves the singleton via the direct-read route', () => {
  const panel = read('src/components/reading-panel/PanelContent.tsx');
  const recentRow = read('src/pages/CognitionCenter.tsx');
  const goalDetail = read('src/pages/GoalDetail.tsx');
  const identityActions = read('src/components/ObjectIdentityActions.tsx');

  // 面板 object 预览对 goal 特判走 /cognition/goal（不占 /objects/:type/:id）。
  assert.match(panel, /objectType === 'goal'\s*\n\s*\? fetchCognitionGoal\(\)/);
  // Human 定案 2026-09-12：goal 不显示状态徽章（详情/面板/近期动态三处一致），
  // 复制按钮与其他对象一致（ObjectReferenceCopyButton 白名单含 goal），
  // 引用形态为 projectId@目标md路径（25 §5 单例路径即身份）。
  assert.match(panel, /const status = objectType === 'goal' \? undefined : readable/);
  assert.match(panel, /target=\{objectType === 'goal' \? readMeta\.canonicalPath \?\? objectId : objectId\}/);
  assert.match(identityActions, /\|\| objectType === 'goal'\)\) && \(/);
  assert.match(recentRow, /\{status && item\.type !== 'goal' && <StatusBadge/);
  assert.match(recentRow, /objectId=\{item\.type === 'goal' \? 'ldvh-base\/goal\.md' : item\.id\}/);
  // 详情页不传 status（头部无状态徽章）。
  assert.doesNotMatch(goalDetail, /status=\{headerStatus\}/);
});

test('cognition goal section exposes the detail entry', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  assert.match(goalSection, /navigate\('\/goal'\)/);
  assert.match(goalSection, /t\('goalDetail\.openDetail'\)/);
});
