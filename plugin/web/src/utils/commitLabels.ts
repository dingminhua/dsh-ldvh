import { getCommitScopeLocale, getCommitTypeLocale } from '../i18n/locales.ts';

export const CURRENT_COMMIT_TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'merge', 'release', 'revert',
] as const;

export const CURRENT_COMMIT_SCOPES = [
  'specs', 'docs', 'rules', 'runtime', 'code', 'web', 'tests', 'config',
  // 29 号 DevLog 已于 2026-11-14 撤除：devlog 退出提交 scope 值域。
  'adr', 'spark', 'research', 'pitfall', 'friction', 'norm', 'subgoal',
] as const;

export function getCommitTypeLabel(type: string | undefined, locale: string) {
  return getCommitTypeLocale(type, locale);
}

export function getCommitScopeLabel(scope: string | undefined, locale: string) {
  return getCommitScopeLocale(scope, locale);
}
