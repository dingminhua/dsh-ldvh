import { getCommitScopeLocale, getCommitTypeLocale } from '../i18n/locales.ts';

export const CURRENT_COMMIT_TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'merge', 'release', 'revert',
] as const;

export const CURRENT_COMMIT_SCOPES = [
  'specs', 'docs', 'rules', 'runtime', 'code', 'web', 'tests', 'config',
  'workcase', 'adr', 'spark', 'study', 'pitfall',
] as const;

export function getCommitTypeLabel(type: string | undefined, locale: string) {
  return getCommitTypeLocale(type, locale);
}

export function getCommitScopeLabel(scope: string | undefined, locale: string) {
  return getCommitScopeLocale(scope, locale);
}
