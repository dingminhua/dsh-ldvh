import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  groupWorkCaseAssociations,
  type WorkCaseAssociationGroup,
} from '../../src/utils/workcaseAssociationGroups.ts';
import { type FactCardAssociation } from '../../src/utils/api.ts';

/**
 * Behavioral lock for closed WorkCase association grouping.
 *
 * The three projections (`relations`, outgoing `refs`, inbound `factRefSources`)
 * may point at the same object. The card must show that object once and keep
 * each real relation key / direction, without ever matching titles, collapsing
 * conflicts, or inventing availability.
 */

const PROJECT = 'project-a';
const OTHER_PROJECT = 'project-b';
const SPARK_UID = '0198f1c7-8a2b-4c3d-9e4f-aaaaaaaaaaaa';
const SPARK_UID_2 = '0198f1c7-8a2b-4c3d-9e4f-bbbbbbbbbbbb';
const SPARK_UID_3 = '0198f1c7-8a2b-4c3d-9e4f-cccccccccccc';
const COMMIT = 'e4e178fd7e3293f47003ed0150ab1128cc6ae0ef';

type Locator = {
  governedProjectId: string;
  factTypeKey: string;
  objectId: string;
};

function locator(
  objectId: string,
  project = PROJECT,
  factTypeKey = 'spark',
): Locator {
  return { governedProjectId: project, factTypeKey, objectId };
}

function association(
  target: FactCardAssociation['target'],
  extra: Partial<FactCardAssociation> = {},
): FactCardAssociation {
  return { available: true, target, ...extra };
}

/** Historical projections sometimes carried no target at all. */
function legacyAssociation(extra: Partial<FactCardAssociation> = {}): FactCardAssociation {
  return { available: false, ...extra } as unknown as FactCardAssociation;
}

function nonNull(group: WorkCaseAssociationGroup | null | undefined): WorkCaseAssociationGroup {
  assert.ok(group, 'expected a non-null association group');
  return group;
}

test('outgoing ref, inbound ref and routed-to to the same object become one group with all meanings', () => {
  const targetLocator = locator('spark-0007');
  const result = groupWorkCaseAssociations(
    [association(
      { objectUid: SPARK_UID },
      { relationKey: 'routed-to', resolvedTarget: targetLocator, title: 'Spark target' },
    )],
    [association({ objectUid: SPARK_UID }, { resolvedTarget: targetLocator })],
    [association({ objectUid: SPARK_UID }, { resolvedTarget: targetLocator, title: 'inbound source' })],
    1,
    PROJECT,
  );

  assert.equal(result.inline.length, 1);
  assert.equal(result.pairingMismatch, false);
  assert.deepEqual(result.other, []);
  const group = nonNull(result.inline[0]);
  assert.deepEqual(group.meanings, [
    { kind: 'relation', relationKey: 'routed-to' },
    { kind: 'outgoing-ref' },
    { kind: 'incoming-ref' },
  ]);
  assert.equal(group.inlineIndex, 0);
  assert.deepEqual(group.association.resolvedTarget, targetLocator);
  assert.equal(group.association.available, true);
});

test('截图形态：去向目标与另一双向引用对象各只出现一次', () => {
  const routed = locator('spark-7c93343c');
  const mutual = locator('spark-64754323');
  const result = groupWorkCaseAssociations(
    [association({ objectUid: SPARK_UID }, { relationKey: 'routed-to', resolvedTarget: routed })],
    [association({ objectUid: SPARK_UID_2 }, { resolvedTarget: mutual })],
    [
      association({ objectUid: SPARK_UID }, { resolvedTarget: routed }),
      association({ objectUid: SPARK_UID_2 }, { resolvedTarget: mutual }),
    ],
    1,
    PROJECT,
  );
  assert.equal(result.pairingMismatch, false);
  assert.equal(result.inline.filter(Boolean).length, 1);
  assert.equal(result.other.length, 1);
  assert.deepEqual(nonNull(result.inline[0]).meanings, [
    { kind: 'relation', relationKey: 'routed-to' },
    { kind: 'incoming-ref' },
  ]);
  assert.deepEqual(result.other[0].meanings, [
    { kind: 'outgoing-ref' },
    { kind: 'incoming-ref' },
  ]);
});

test('equal titles with different UIDs are never merged as the same object', () => {
  const result = groupWorkCaseAssociations(
    [
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to', title: 'Same title' }),
      association({ objectUid: SPARK_UID_2 }, { relationKey: 'routed-to', title: 'Same title' }),
    ],
    [],
    [],
    2,
    PROJECT,
  );

  assert.equal(result.other.length, 0);
  assert.equal(result.pairingMismatch, false);
  const first = nonNull(result.inline[0]);
  const second = nonNull(result.inline[1]);
  assert.notEqual(first.key, second.key);
  assert.deepEqual(first.meanings, [{ kind: 'relation', relationKey: 'routed-to' }]);
  assert.deepEqual(second.meanings, [{ kind: 'relation', relationKey: 'routed-to' }]);
});

test('prefers an available display object that carries a locator over an unavailable UID row', () => {
  const targetLocator = locator('spark-0007');
  const result = groupWorkCaseAssociations(
    [],
    [association({ objectUid: SPARK_UID }, { available: false, resolvedTarget: targetLocator })],
    [association(targetLocator, { title: 'Readable inbound source' })],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 1);
  const group = result.other[0];
  assert.deepEqual(group.meanings, [{ kind: 'outgoing-ref' }, { kind: 'incoming-ref' }]);
  assert.equal(group.association.available, true, 'availability comes from a real input row');
  assert.deepEqual(group.association.target, targetLocator, 'the preferred row still points at the locator');
});

test('an all-unavailable group stays unavailable and does not gain a fabricated locator', () => {
  const result = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }, { available: false }),
      association({ objectUid: SPARK_UID }, { available: false, title: 'unreadable' }),
    ],
    [],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 1);
  assert.equal(result.other[0].association.available, false);
  assert.equal(result.other[0].association.resolvedTarget, undefined);
  assert.deepEqual(result.other[0].meanings, [{ kind: 'outgoing-ref' }]);
});

test('keeps every distinct relation key for one target and removes only truly identical meanings', () => {
  const result = groupWorkCaseAssociations(
    [
      association({ objectUid: SPARK_UID }, { relationKey: 'informs' }),
      association({ objectUid: SPARK_UID }, { relationKey: 'derived-from' }),
      association({ objectUid: SPARK_UID }, { relationKey: 'informs' }),
    ],
    [],
    [],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 1);
  assert.deepEqual(result.other[0].meanings, [
    { kind: 'relation', relationKey: 'informs' },
    { kind: 'relation', relationKey: 'derived-from' },
  ]);
});

test('a unique UID↔locator mapping merges the two shapes', () => {
  const targetLocator = locator('spark-0007');
  const result = groupWorkCaseAssociations(
    [association({ objectUid: SPARK_UID }, { resolvedTarget: targetLocator })],
    [],
    [association(targetLocator)],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 1);
  assert.deepEqual(result.other[0].meanings, [
    { kind: 'relation', relationKey: null },
    { kind: 'incoming-ref' },
  ]);
  assert.equal(result.other[0].identityConflict, false, 'a unique mapping is clickable');
});

test('a UID resolving to multiple locators keeps every entry independent and flags the conflict', () => {
  const first = locator('spark-0007');
  const second = locator('spark-0008');
  const result = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }, { resolvedTarget: first }),
      association({ objectUid: SPARK_UID }, { resolvedTarget: second }),
    ],
    [association(first)],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 3, 'conflicting entries must each be retained, not merged or dropped');
  assert.deepEqual(result.other.map((group) => group.meanings), [
    [{ kind: 'outgoing-ref' }],
    [{ kind: 'outgoing-ref' }],
    [{ kind: 'incoming-ref' }],
  ]);
  assert.equal(new Set(result.other.map((group) => group.key)).size, 3);
  assert.deepEqual(result.other.map((group) => group.identityConflict), [true, true, true]);
});

test('one locator claimed by two UIDs is not used to merge them (bidirectional uniqueness)', () => {
  const targetLocator = locator('spark-0007');
  const result = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }, { resolvedTarget: targetLocator }),
      association({ objectUid: SPARK_UID_2 }, { resolvedTarget: targetLocator }),
    ],
    [association(targetLocator)],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 3);
  assert.deepEqual(result.other.map((group) => group.meanings), [
    [{ kind: 'outgoing-ref' }],
    [{ kind: 'outgoing-ref' }],
    [{ kind: 'incoming-ref' }],
  ]);
  assert.equal(new Set(result.other.map((group) => group.key)).size, 3);
  assert.deepEqual(result.other.map((group) => group.identityConflict), [true, true, true]);
});

test('an unresolved UID falling into an ambiguous mapping stays independent and non-clickable', () => {
  const first = locator('spark-0007');
  const second = locator('spark-0008');
  const uidAmbiguous = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }, { resolvedTarget: first }),
      association({ objectUid: SPARK_UID }, { resolvedTarget: second }),
      association({ objectUid: SPARK_UID }),
    ],
    [],
    0,
    PROJECT,
  );
  assert.equal(uidAmbiguous.other.length, 3, 'the unresolved row is retained rather than folded into the conflict');
  assert.equal(new Set(uidAmbiguous.other.map((group) => group.key)).size, 3);
  assert.deepEqual(uidAmbiguous.other.map((group) => group.identityConflict), [true, true, true]);

  const claimedLocator = locator('spark-0009');
  const locatorAmbiguous = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }, { resolvedTarget: claimedLocator }),
      association({ objectUid: SPARK_UID_2 }, { resolvedTarget: claimedLocator }),
      association({ objectUid: SPARK_UID }),
    ],
    [],
    0,
    PROJECT,
  );
  assert.equal(locatorAmbiguous.other.length, 3);
  assert.deepEqual(locatorAmbiguous.other.map((group) => group.identityConflict), [true, true, true]);
});

test('a mapping conflict does not stop other same-project groups from merging normally', () => {
  const first = locator('spark-0007');
  const second = locator('spark-0008');
  const normal = locator('spark-0009');
  const result = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }, { resolvedTarget: first }),
      association({ objectUid: SPARK_UID }, { resolvedTarget: second }),
      association({ objectUid: SPARK_UID_3 }, { resolvedTarget: normal }),
    ],
    [association(normal)],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 3);
  assert.deepEqual(result.other.slice(0, 2).map((group) => group.identityConflict), [true, true]);
  const merged = result.other[2];
  assert.deepEqual(merged.meanings, [{ kind: 'outgoing-ref' }, { kind: 'incoming-ref' }]);
  assert.equal(merged.identityConflict, false, 'an unambiguous same-project group must still merge and stay clickable');
});

test('cross-project locators are not used to merge identities', () => {
  const otherLocator = locator('spark-0007', OTHER_PROJECT);
  const result = groupWorkCaseAssociations(
    [],
    [association({ objectUid: SPARK_UID }, { resolvedTarget: otherLocator })],
    [association(otherLocator)],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 2, 'a locator from another project is a different identity');
  assert.notEqual(result.other[0].key, result.other[1].key);
  assert.deepEqual(result.other.map((group) => group.identityConflict), [true, true]);
});

test('目标 locator 与 resolvedTarget 不一致或非法时保留且禁止打开', () => {
  const target = locator('spark-0007');
  const candidates: Array<Partial<FactCardAssociation>> = [
    { resolvedTarget: locator('spark-0008') },
    { resolvedTarget: locator('spark-0007', OTHER_PROJECT) },
    { resolvedTarget: { governedProjectId: PROJECT } as FactCardAssociation['resolvedTarget'] },
  ];
  for (const extra of candidates) {
    const result = groupWorkCaseAssociations([], [association(target, extra)], [], 0, PROJECT);
    assert.equal(result.other.length, 1);
    assert.equal(result.other[0].identityConflict, true);
  }
  const valid = groupWorkCaseAssociations([], [association(target, { resolvedTarget: target })], [], 0, PROJECT);
  assert.equal(valid.other[0].identityConflict, false);
});

test('UID 条目的非法 resolvedTarget 不得成为可点击定位符', () => {
  const invalid = { governedProjectId: PROJECT } as FactCardAssociation['resolvedTarget'];
  const result = groupWorkCaseAssociations([], [association({ objectUid: SPARK_UID }, { resolvedTarget: invalid })], [], 0, PROJECT);
  assert.equal(result.other.length, 1);
  assert.equal(result.other[0].identityConflict, true);
});

test('a single cross-project locator is retained but flagged non-clickable without any mapping ambiguity', () => {
  const otherLocator = locator('spark-0007', OTHER_PROJECT);
  const direct = groupWorkCaseAssociations(
    [],
    [],
    [association(otherLocator, { title: 'other project target' })],
    0,
    PROJECT,
  );
  assert.equal(direct.other.length, 1, 'the entry must be retained, not dropped');
  assert.equal(direct.other[0].association.title, 'other project target');
  assert.equal(direct.other[0].identityConflict, true, 'opening it would use the current project and the wrong object');

  const viaUid = groupWorkCaseAssociations(
    [],
    [association({ objectUid: SPARK_UID }, { resolvedTarget: otherLocator })],
    [],
    0,
    PROJECT,
  );
  assert.equal(viaUid.other.length, 1);
  assert.equal(viaUid.other[0].identityConflict, true);
});

test('same type/objectId in different projects remains two identities', () => {
  const result = groupWorkCaseAssociations(
    [],
    [],
    [
      association(locator('spark-0007', PROJECT)),
      association(locator('spark-0007', OTHER_PROJECT)),
    ],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 2);
  assert.deepEqual(result.other.map((group) => group.meanings), [
    [{ kind: 'incoming-ref' }],
    [{ kind: 'incoming-ref' }],
  ]);
  assert.deepEqual(result.other.map((group) => group.identityConflict), [false, true]);
});

test('the same UID resolved to different projects is split by project, not merged by the bare UID', () => {
  const result = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }, { resolvedTarget: locator('spark-0007', PROJECT) }),
      association({ objectUid: SPARK_UID }, { resolvedTarget: locator('spark-0007', OTHER_PROJECT) }),
    ],
    [],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 2, 'an explicit cross-project resolvedTarget must not merge with the current project');
  assert.notEqual(result.other[0].key, result.other[1].key);
  assert.deepEqual(result.other.map((group) => group.meanings), [
    [{ kind: 'outgoing-ref' }],
    [{ kind: 'outgoing-ref' }],
  ]);
  assert.deepEqual(result.other.map((group) => group.identityConflict), [true, true]);
});

test('an empty currentProjectId keeps an unresolved UID separate from an explicit other-project target', () => {
  const result = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }),
      association({ objectUid: SPARK_UID }, { resolvedTarget: locator('spark-0007', OTHER_PROJECT) }),
    ],
    [],
    0,
    '',
  );

  assert.equal(result.other.length, 2, 'the unresolved row defaults to the empty current project, not the other project');
  assert.notEqual(result.other[0].key, result.other[1].key);
  assert.deepEqual(result.other.map((group) => group.identityConflict), [true, true], 'unknown current project disables opening');

  // Fail closed: with no project information at all, identical UID text is not
  // proof that the two rows belong to the same project.
  const sameUidOnly = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }),
      association({ objectUid: SPARK_UID }),
    ],
    [],
    0,
    '',
  );
  assert.equal(sameUidOnly.other.length, 2, 'unknown project must never be collapsed into one empty-project identity');
  assert.notEqual(sameUidOnly.other[0].key, sameUidOnly.other[1].key);
  assert.deepEqual(sameUidOnly.other.map((group) => group.identityConflict), [true, true]);
});

test('a known-project locator is still non-clickable when currentProjectId itself is empty', () => {
  const result = groupWorkCaseAssociations(
    [],
    [],
    [association(locator('spark-0007', PROJECT))],
    0,
    '',
  );

  assert.equal(result.other.length, 1);
  assert.equal(result.other[0].identityConflict, true, 'the open path cannot confirm which project to reuse');
});

test('fail-closed unknown-project UID keys are stable across calls and still match their own groups when pairing', () => {
  const run = () => groupWorkCaseAssociations(
    [
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to' }),
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to' }),
    ],
    [],
    [],
    2,
    '',
  );

  const first = run();
  const second = run();

  // Both routed-to rows must pair: if identityKey assigned a fresh key on the
  // second call, the group lookup would miss and leave the slots null.
  assert.equal(first.pairingMismatch, false);
  assert.equal(first.inline.length, 2);
  const firstKeys = first.inline.map((group) => nonNull(group).key);
  assert.equal(new Set(firstKeys).size, 2, 'each unverifiable row keeps its own identity');
  assert.deepEqual(first.inline.map((group) => nonNull(group).identityConflict), [true, true]);
  assert.deepEqual(first.other, []);

  // Repeated invocations must produce byte-identical keys, not random ones.
  assert.deepEqual(firstKeys, second.inline.map((group) => nonNull(group).key));
});

test('more routed-to entries than advice slots keep every routed-to in other with all inline slots null', () => {
  const result = groupWorkCaseAssociations(
    [
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to', title: 'first' }),
      association({ objectUid: SPARK_UID_2 }, { relationKey: 'routed-to', title: 'second' }),
      association({ objectUid: SPARK_UID_3 }, { relationKey: 'routed-to', title: 'third' }),
    ],
    [],
    [],
    2,
    PROJECT,
  );

  assert.equal(result.pairingMismatch, true, 'a count difference must be reported, not paired by min');
  assert.deepEqual(result.inline, [null, null]);
  assert.equal(result.other.length, 3, 'no routed-to may be dropped or attached to a guessed advice row');
  assert.deepEqual(result.other.map((group) => group.association.title), ['first', 'second', 'third']);
  assert.deepEqual(result.other.map((group) => group.inlineIndex), [null, null, null]);
  assert.deepEqual(result.other.map((group) => group.meanings), [
    [{ kind: 'relation', relationKey: 'routed-to' }],
    [{ kind: 'relation', relationKey: 'routed-to' }],
    [{ kind: 'relation', relationKey: 'routed-to' }],
  ]);
});

test('more advice slots than routed-to entries also disables pairing entirely', () => {
  const result = groupWorkCaseAssociations(
    [
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to', title: 'only target' }),
      association({ objectUid: SPARK_UID_2 }, { relationKey: 'routed-to', title: 'second target' }),
    ],
    [],
    [],
    3,
    PROJECT,
  );

  assert.equal(result.pairingMismatch, true);
  assert.deepEqual(result.inline, [null, null, null]);
  assert.equal(result.other.length, 2);
  assert.deepEqual(result.other.map((group) => group.association.title), ['only target', 'second target']);
});

test('去向存在但无任何关联时只提示不匹配，不伪造关联列表', () => {
  const result = groupWorkCaseAssociations([], [], [], 1, PROJECT);
  assert.equal(result.pairingMismatch, true);
  assert.deepEqual(result.inline, [null]);
  assert.deepEqual(result.other, []);
});

test('a source [A,A,B] already deduped by the backend to [A,B] is not re-read or force-paired to three advice rows', () => {
  // `facts.ts` dedupes relations by target, so the function receives [A, B]
  // while the advice block still has three rows. The dropped duplicate is not
  // recoverable mechanically; it must not be invented, and B must not be
  // attached to the second advice row that may have belonged to A.
  const result = groupWorkCaseAssociations(
    [
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to', title: 'target A' }),
      association({ objectUid: SPARK_UID_2 }, { relationKey: 'routed-to', title: 'target B' }),
    ],
    [],
    [],
    3,
    PROJECT,
  );

  assert.equal(result.pairingMismatch, true);
  assert.deepEqual(result.inline, [null, null, null]);
  assert.equal(result.other.length, 2, 'only the two projected targets exist; no synthetic third entry');
  assert.deepEqual(result.other.map((group) => group.association.title), ['target A', 'target B']);
  assert.deepEqual(result.other.map((group) => group.meanings), [
    [{ kind: 'relation', relationKey: 'routed-to' }],
    [{ kind: 'relation', relationKey: 'routed-to' }],
  ]);
  assert.equal(new Set(result.other.map((group) => group.key)).size, 2);
});

test('a non-positive or non-finite advice count yields no inline rows', () => {
  for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = groupWorkCaseAssociations(
      [association({ objectUid: SPARK_UID }, { relationKey: 'routed-to' })],
      [],
      [],
      count,
      PROJECT,
    );
    assert.deepEqual(result.inline, []);
    assert.equal(result.pairingMismatch, true, 'one routed-to cannot be paired with zero advice rows');
    assert.equal(result.other.length, 1);
    assert.equal(result.other[0].inlineIndex, null);
  }
});

test('a repeated routed-to object occupies only its first advice slot', () => {
  const result = groupWorkCaseAssociations(
    [
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to' }),
      association({ objectUid: SPARK_UID_2 }, { relationKey: 'routed-to' }),
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to' }),
    ],
    [],
    [],
    3,
    PROJECT,
  );

  assert.equal(result.inline.length, 3);
  assert.equal(result.pairingMismatch, false);
  const first = nonNull(result.inline[0]);
  const second = nonNull(result.inline[1]);
  assert.equal(result.inline[2], null, 'the duplicate object must not appear in a second slot');
  assert.notEqual(first.key, second.key);
  assert.deepEqual(first.meanings, [{ kind: 'relation', relationKey: 'routed-to' }]);
  assert.equal(result.other.length, 0, 'the duplicate is shown by the first slot, not moved to other');
});

test('non-routed groups keep a stable order across relations, refs and inbound rows', () => {
  const result = groupWorkCaseAssociations(
    [
      association({ objectUid: SPARK_UID_3 }, { relationKey: 'informs' }),
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to' }),
    ],
    [association({ objectUid: SPARK_UID_2 })],
    [association(locator('spark-0009'))],
    1,
    PROJECT,
  );

  assert.deepEqual(result.inline.map((group) => nonNull(group).meanings), [
    [{ kind: 'relation', relationKey: 'routed-to' }],
  ]);
  assert.equal(result.pairingMismatch, false);
  assert.deepEqual(result.other.map((group) => group.meanings), [
    [{ kind: 'relation', relationKey: 'informs' }],
    [{ kind: 'outgoing-ref' }],
    [{ kind: 'incoming-ref' }],
  ]);
  assert.deepEqual(result.other.map((group) => group.inlineIndex), [null, null, null]);
});

test('commit targets are isolated from fact-object identities and keep their meanings', () => {
  const targetLocator = locator('spark-0007');
  const result = groupWorkCaseAssociations(
    [
      association({ commit: COMMIT }, { relationKey: 'routed-to' }),
      association({ commit: COMMIT }, { relationKey: 'informs' }),
      association({ objectUid: SPARK_UID }, { relationKey: 'routed-to', resolvedTarget: targetLocator }),
    ],
    [],
    [],
    2,
    PROJECT,
  );

  assert.equal(result.inline.length, 2);
  assert.equal(result.pairingMismatch, false);
  assert.equal(result.other.length, 0);
  const commitGroup = nonNull(result.inline[0]);
  const objectGroup = nonNull(result.inline[1]);
  assert.notEqual(commitGroup.key, objectGroup.key);
  assert.deepEqual(commitGroup.meanings, [
    { kind: 'relation', relationKey: 'routed-to' },
    { kind: 'relation', relationKey: 'informs' },
  ]);
  assert.deepEqual(commitGroup.association.target, { commit: COMMIT });
  assert.equal(commitGroup.identityConflict, false, 'a known current project keeps a commit row clickable');
});

test('commit 不应携带对象定位符，冲突元数据不能作为可信状态', () => {
  const result = groupWorkCaseAssociations(
    [association({ commit: COMMIT }, { resolvedTarget: locator('spark-0007') })], [], [], 0, PROJECT,
  );
  assert.equal(result.other.length, 1);
  assert.equal(result.other[0].identityConflict, true);
});

test('commit rows are non-clickable and independent when currentProjectId is empty', () => {
  const secondCommit = 'f'.repeat(40);
  const missing = legacyAssociation({ title: 'no target' });
  const result = groupWorkCaseAssociations(
    [
      association({ commit: COMMIT }, { relationKey: 'routed-to' }),
      association({ commit: COMMIT }, { relationKey: 'routed-to' }),
      association({ commit: secondCommit }, { relationKey: 'routed-to' }),
      missing,
    ],
    [],
    [],
    3,
    '',
  );

  assert.equal(result.pairingMismatch, false);
  assert.equal(result.inline.length, 3);
  const groups = result.inline.map((group) => nonNull(group));
  assert.equal(new Set(groups.map((group) => group.key)).size, 3, 'unknown project keeps each commit row independent');
  assert.deepEqual(groups.map((group) => group.identityConflict), [true, true, true]);
  assert.deepEqual(groups.map((group) => group.association.target), [
    { commit: COMMIT },
    { commit: COMMIT },
    { commit: secondCommit },
  ]);

  assert.equal(result.other.length, 1);
  assert.equal(result.other[0].association, missing, 'a missing-target row is retained');
  assert.equal(result.other[0].identityConflict, true, 'missing target cannot confirm which edge the locator belonged to');
});

test('invalid commit shapes are treated as missing and identical illegal values never merge', () => {
  for (const invalidCommit of [
    'abc1234',
    'z'.repeat(40),
    'refs/heads/main',
    ` ${COMMIT} `, // rendered navigation must not use an untrimmed hash
    'e4e178fd7e3293f47003ed0150ab1128cc6ae0e', // 39 chars
  ]) {
    const result = groupWorkCaseAssociations(
      [
        association({ commit: invalidCommit }, { relationKey: 'routed-to' }),
        association({ commit: invalidCommit }, { relationKey: 'routed-to' }),
      ],
      [],
      [],
      2,
      PROJECT,
    );

    assert.equal(result.pairingMismatch, false);
    assert.equal(result.inline.length, 2);
    const groups = result.inline.map((group) => nonNull(group));
    assert.equal(new Set(groups.map((group) => group.key)).size, 2, `identical illegal commit ${JSON.stringify(invalidCommit)} must not merge`);
    assert.deepEqual(groups.map((group) => group.identityConflict), [true, true]);
    assert.deepEqual(groups.map((group) => group.association.target), [
      { commit: invalidCommit },
      { commit: invalidCommit },
    ]);
  }
});

test('legacy entries without a target stay independent and are never merged by title or commit', () => {
  const firstLegacy = legacyAssociation({ title: 'Same title' });
  const secondLegacy = legacyAssociation({ title: 'Same title' });
  const result = groupWorkCaseAssociations(
    [
      association({ commit: COMMIT }, { relationKey: 'routed-to' }),
      firstLegacy,
      secondLegacy,
    ],
    [],
    [],
    1,
    PROJECT,
  );

  assert.equal(result.inline.length, 1);
  assert.equal(result.pairingMismatch, false);
  assert.deepEqual(nonNull(result.inline[0]).association.target, { commit: COMMIT });
  assert.equal(result.other.length, 2, 'each missing-target row is an independent item');
  assert.notEqual(result.other[0].key, result.other[1].key);
  assert.equal(result.other[0].association, firstLegacy, 'the original row is preserved, not rebuilt');
  assert.equal(result.other[1].association, secondLegacy);
  assert.equal(result.other[0].inlineIndex, null);
  assert.equal(result.other[1].inlineIndex, null);
  assert.deepEqual(result.other.map((group) => group.identityConflict), [true, true]);
});

test('a targetless row with available:true and resolvedTarget is non-clickable and never merged with the exact locator row', () => {
  const resolved = locator('spark-0007');
  const orphaned = legacyAssociation({
    available: true,
    resolvedTarget: resolved,
    title: 'orphaned edge',
  });
  const exact = association(resolved, { title: 'exact target' });

  const mixed = groupWorkCaseAssociations([], [], [orphaned, exact], 0, PROJECT);
  assert.equal(mixed.other.length, 2, 'the leftover resolvedTarget must not be treated as the missing edge identity');
  assert.notEqual(mixed.other[0].key, mixed.other[1].key);
  assert.equal(mixed.other[0].association, orphaned);
  assert.equal(mixed.other[0].identityConflict, true, 'available + resolvedTarget still cannot repair a missing target');
  assert.equal(mixed.other[1].association, exact);
  assert.equal(mixed.other[1].identityConflict, false, 'the exact locator row remains a normal clickable identity');

  // Two targetless rows stay independent even when their leftover metadata is identical.
  const orphanedTwin = legacyAssociation({
    available: true,
    resolvedTarget: resolved,
    title: 'orphaned edge',
  });
  const pair = groupWorkCaseAssociations([], [], [orphaned, orphanedTwin], 0, PROJECT);
  assert.equal(pair.other.length, 2);
  assert.notEqual(pair.other[0].key, pair.other[1].key);
  assert.deepEqual(pair.other.map((group) => group.identityConflict), [true, true]);
});

test('UID matching folds UUID case', () => {
  const result = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID.toUpperCase() }),
      association({ objectUid: SPARK_UID.toLowerCase() }),
    ],
    [],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 1);
  assert.deepEqual(result.other[0].meanings, [{ kind: 'outgoing-ref' }]);
});

test('invalid UID shapes are treated as missing and identical illegal values never merge', () => {
  for (const invalidUid of [
    'spark-0001',
    'not-a-uid',
    // UUIDv7 is explicitly not the canonical identity (specs/03 §6.1).
    '0198f1c7-8a2b-7c3d-9e4f-123456789abc',
  ]) {
    const result = groupWorkCaseAssociations(
      [],
      [
        association({ objectUid: invalidUid }),
        association({ objectUid: invalidUid }),
      ],
      [],
      0,
      PROJECT,
    );

    assert.equal(result.other.length, 2, `identical illegal UID ${JSON.stringify(invalidUid)} must not merge`);
    assert.notEqual(result.other[0].key, result.other[1].key);
    assert.deepEqual(result.other.map((group) => group.identityConflict), [true, true]);
    assert.deepEqual(result.other.map((group) => group.meanings), [
      [{ kind: 'outgoing-ref' }],
      [{ kind: 'outgoing-ref' }],
    ]);
  }
});

test('the declared single-key and three-key target shapes remain legal', () => {
  const result = groupWorkCaseAssociations(
    [],
    [
      association({ objectUid: SPARK_UID }),
      association({ commit: COMMIT }),
      association(locator('spark-0007')),
    ],
    [],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 3);
  assert.deepEqual(result.other.map((group) => group.identityConflict), [false, false, false]);
  assert.deepEqual(result.other.map((group) => group.meanings), [
    [{ kind: 'outgoing-ref' }],
    [{ kind: 'outgoing-ref' }],
    [{ kind: 'outgoing-ref' }],
  ]);
});

test('targets with extra or mixed keys are missing, independent and non-clickable', () => {
  const baseLocator = locator('spark-0007');
  const malformedTargets: FactCardAssociation['target'][] = [
    // UID plus unrelated locator metadata.
    { objectUid: SPARK_UID, ...baseLocator } as unknown as FactCardAssociation['target'],
    { objectUid: SPARK_UID, objectId: 'spark-0007' } as unknown as FactCardAssociation['target'],
    // Commit plus extra keys.
    { commit: COMMIT, objectUid: SPARK_UID } as unknown as FactCardAssociation['target'],
    { commit: COMMIT, extra: true } as unknown as FactCardAssociation['target'],
    // Locator plus extra keys, or an incomplete locator.
    { ...baseLocator, extra: true } as unknown as FactCardAssociation['target'],
    { ...baseLocator, objectUid: SPARK_UID } as unknown as FactCardAssociation['target'],
    { governedProjectId: PROJECT, factTypeKey: 'spark' } as unknown as FactCardAssociation['target'],
  ];

  for (const target of malformedTargets) {
    const result = groupWorkCaseAssociations(
      [],
      [association(target), association(target)],
      [],
      0,
      PROJECT,
    );
    const label = JSON.stringify(target);
    assert.equal(result.other.length, 2, `${label} must be retained as two independent rows`);
    assert.notEqual(result.other[0].key, result.other[1].key);
    assert.deepEqual(result.other.map((group) => group.identityConflict), [true, true], `${label} must not be clickable`);
  }
});

test('an unresolved UID is not merged with a same-shaped locator', () => {
  const result = groupWorkCaseAssociations(
    [],
    [association({ objectUid: SPARK_UID })],
    [association(locator('spark-0007'))],
    0,
    PROJECT,
  );

  assert.equal(result.other.length, 2, 'merging here would fabricate a UID↔locator mapping');
  assert.notEqual(result.other[0].key, result.other[1].key);
});
