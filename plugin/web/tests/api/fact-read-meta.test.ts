import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load as loadYaml } from 'js-yaml';
import {
  getFactReadMeta,
  isReadableFact,
  projectFactObjectFields,
  reconstructFactYaml,
} from '../../src/utils/factReadMeta.ts';

test('source metadata is consumable only from a readable exact result', () => {
  const meta = getFactReadMeta({
    canonical_path: 'ldvh-base/studies/study-0010.md',
    carrier: 'markdown',
    read_status: 'readable',
  });

  assert.equal(isReadableFact(meta), true);
  assert.equal(meta.canonicalPath, 'ldvh-base/studies/study-0010.md');
  assert.equal(meta.carrier, 'markdown');
});

test('a route target, ID, or expected path alone never becomes a source path', () => {
  const fromNavigation = getFactReadMeta({
    target: 'study-0010',
    object_id: 'study-0010',
    carrier: 'markdown',
    read_status: 'readable',
  });
  assert.equal(isReadableFact(fromNavigation), false);
  assert.equal(fromNavigation.canonicalPath, undefined);

  const failure = getFactReadMeta({
    fact_read_failure: true,
    canonical_path: 'ldvh-base/studies/study-0010.md',
    carrier: 'markdown',
    read_status: 'unreadable',
    read_issues: [{ code: 'yaml_parse_failed', path: 'ldvh-base/studies/study-0010.md', message: 'frontmatter cannot be parsed' }],
  });
  assert.equal(isReadableFact(failure), false);
  assert.equal(failure.canonicalPath, 'ldvh-base/studies/study-0010.md');
  assert.equal(failure.issues[0]?.category, 'yaml_parse_failed');
  assert.equal(failure.issues[0]?.fieldPath, 'ldvh-base/studies/study-0010.md');
  assert.equal(failure.issues[0]?.summary, 'frontmatter cannot be parsed');
});

test('WorkCase uses the same readable state as every current fact type', () => {
  const meta = getFactReadMeta({
    canonical_path: 'ldvh-base/workcases/workcase-0010.yaml',
    carrier: 'yaml',
    read_status: 'readable',
  });

  assert.equal(isReadableFact(meta), true);
  assert.equal(meta.readStatus, 'readable');
});

test('reconstructed carrier data excludes exact-read metadata without dropping fact identity', () => {
  const fact = projectFactObjectFields({
    object_id: 'workcase-0010',
    fact_type_key: 'workcase',
    title: '当前事实',
    status: 'open',
    object_ref: { governed_project_id: 'project-current' },
    canonical_path: 'ldvh-base/workcases/workcase-0010.yaml',
    carrier: 'yaml',
    read_status: 'readable',
    content_fingerprint: 'a'.repeat(64),
    coverage_status: 'complete',
    observed_at: '2026-07-26T15:00:00+08:00',
    read_issues: [],
  });

  assert.deepEqual(fact, {
    object_id: 'workcase-0010',
    fact_type_key: 'workcase',
    title: '当前事实',
    status: 'open',
  });
});

test('reconstructed YAML preserves strings that resemble YAML scalars', () => {
  const source = {
    object_id: 'workcase-0010',
    string_true: 'true',
    string_number: '123',
    empty_string: '',
    actual_boolean: true,
    actual_number: 123,
    canonical_path: 'ldvh-base/workcases/workcase-0010.yaml',
  };

  const reconstructed = reconstructFactYaml(source);
  assert.deepEqual(loadYaml(reconstructed), {
    object_id: 'workcase-0010',
    string_true: 'true',
    string_number: '123',
    empty_string: '',
    actual_boolean: true,
    actual_number: 123,
  });
});
