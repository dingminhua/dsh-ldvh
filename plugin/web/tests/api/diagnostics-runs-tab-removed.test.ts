import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src/pages/Diagnostics.tsx');
const LOCALES = path.resolve('src/i18n/locales.ts');

test('诊断页不再提供「运行痕迹」tab：Tab 闭集只有 gate/observations/cleanup', () => {
  const src = readFileSync(SRC, 'utf8');
  const tabType = src.match(/type Tab = ([^;]+);/);
  assert.ok(tabType, 'Diagnostics.tsx 须声明 Tab 类型');
  assert.doesNotMatch(tabType[1], /'queue'/, 'Tab 闭集不得再含 queue');
  assert.match(tabType[1], /'gate'/);
  assert.match(tabType[1], /'observations'/);
  assert.match(tabType[1], /'cleanup'/);
});

test('诊断页不再渲染运行痕迹面板与其数据来源', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.doesNotMatch(src, /QueuePanel/, 'QueuePanel 须已移除');
  assert.doesNotMatch(src, /fetchQueueReport/, '不得再拉取 queue 报告');
  assert.doesNotMatch(src, /diagnostics\.tab\.runs/, '不得再引用运行痕迹 tab 标签键');
  assert.doesNotMatch(src, /diagnostics\.queue\./, '不得再引用运行痕迹面板文案键');
});

test('运行账采集仍在，但不进清理清单（清理会删掉淘汰登记致查重失效）', () => {
  const runlog = readFileSync(path.resolve(import.meta.dirname, '../../../lib/idle-runlog.js'), 'utf8');
  assert.match(runlog, /idle-checkpoint-runs\.json/, '运行账采集不得随界面移除而删除');

  const logsCleanup = readFileSync(path.resolve('api/services/logsCleanup.ts'), 'utf8');
  assert.doesNotMatch(logsCleanup, /idle-checkpoint-runs\.json/, '运行账不得进清理清单');
  assert.doesNotMatch(logsCleanup, /checkpoint-runs/, '不得残留 checkpoint-runs 清理目标');
});

test('失效的界面文案键已从 locales 移除，中英两语一致', () => {
  const locales = readFileSync(LOCALES, 'utf8');
  for (const key of [
    'diagnostics.tab.runs',
    'diagnostics.queue.runs',
    'diagnostics.queue.stopped',
    'diagnostics.queue.stoppedHint',
    'diagnostics.queue.recentRuns',
    'diagnostics.queue.empty',
  ]) {
    const hits = locales.split('\n').filter((line) => line.trim().startsWith(`'${key}':`));
    assert.equal(hits.length, 0, `失效键 ${key} 仍残留在 locales`);
  }
});

test('观察面板的时间走本地化格式，不原样直出 ISO 串', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.match(src, /formatTime\(row\.at\)/, '观察明细时间须经 formatTime');
  assert.match(src, /formatTime\(group\.lastAt\)/, '观察分组时间须经 formatTime');
  assert.doesNotMatch(src, /\{row\.at \?\? '—'\}/, '不得原样直出 ISO 串');
});

test('formatTime 跨年时补年份，同年只出 MM-DD HH:mm', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.match(src, /sameYear/, '须区分同年与跨年');
  assert.match(src, /getFullYear\(\)/, '跨年时须补年份');
});
