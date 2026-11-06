import type { FactCardAssociation } from './api';
import { canonicalUid } from '../../shared/factIdentity';

/**
 * Closed WorkCase association grouping (pure logic).
 *
 * The closed card displays the same fact object through up to three different
 * projections: formal `relations`, outgoing `refs`, and the read-time reverse
 * `factRefSources` projection (converted to `FactCardAssociation` by the
 * caller). These are distinct declared edges and can refer to the same object;
 * the card groups the display row, not the underlying facts, and retains each
 * projected relation key and reference direction on that row.
 *
 * Hard boundaries implemented here:
 * - identity is never inferred from a title;
 * - a UID must pass the shared canonical UUIDv4 predicate (case-folded before
 *   validation), and a commit must be exactly 40 hex characters; targets must
 *   also keep the projection shape (UID/commit single-key, locator exactly its
 *   three declared keys), and invalid shapes are treated as missing;
 * - a UID is folded case-insensitively (UUID identity), while a locator is the
 *   exact `project + type + objectId` identity;
 * - an authoritative UID and a locator are merged **only** when the mapping is
 *   unique in both directions and carries no cross-project ambiguity;
 * - commit targets are not fact objects and never merge with UID/locator
 *   targets;
 * - when neither a resolvedTarget nor a non-empty current project proves a
 *   project, equal UID text is not enough: each row stays independent
 *   (fail-closed);
 * - a row whose locator belongs to another project (or whose current project is
 *   unknown) is `identityConflict`, because the UI open path reuses the current
 *   project and would otherwise open a same-shaped object in the wrong project;
 *   commit rows depend on the same current project and follow the same rule,
 *   while missing-target rows stay independent and `identityConflict` because a
 *   leftover resolvedTarget cannot prove which real edge it belonged to;
 * - legacy entries without a target stay independent; nothing is fabricated.
 *
 * This module deliberately has no React or `@/` imports so the behavior can be
 * asserted directly by `tsx --test`.
 */

export type WorkCaseAssociationMeaning =
  | { kind: 'outgoing-ref' | 'incoming-ref' }
  | { kind: 'relation'; relationKey: string | null };

export type WorkCaseAssociationGroup = {
  key: string;
  association: FactCardAssociation;
  meanings: WorkCaseAssociationMeaning[];
  inlineIndex: number | null;
  /**
   * True for a conflicting or malformed identity, unknown project, or a target
   * outside the current project. The UI must not open it or assert its state.
   */
  identityConflict: boolean;
};

type Locator = {
  governedProjectId: string;
  factTypeKey: string;
  objectId: string;
};

type TargetDescription =
  | { kind: 'uid'; uid: string }
  | { kind: 'locator'; locator: Locator }
  | { kind: 'commit'; commit: string }
  | { kind: 'missing' };

type Origin = 'relations' | 'refs' | 'inbound';

type Entry = {
  association: FactCardAssociation;
  origin: Origin;
  relationKey: string | null;
  routedTo: boolean;
  target: TargetDescription;
  /** Locator resolved from the association itself (target locator or resolvedTarget). */
  locator: Locator | null;
  /** Stable input ordinal; used by fail-closed identities that must not be merged. */
  ordinal: number;
};

type GroupDraft = {
  key: string;
  members: Entry[];
  meanings: WorkCaseAssociationMeaning[];
  meaningKeys: Set<string>;
  representative: Entry;
  representativeScore: number;
  identityConflict: boolean;
};

type ResolvedIdentity = {
  key: string;
  identityConflict: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asLocator(value: unknown): Locator | null {
  if (!isRecord(value)) return null;
  const governedProjectId = nonEmptyString(value.governedProjectId);
  const factTypeKey = nonEmptyString(value.factTypeKey);
  const objectId = nonEmptyString(value.objectId);
  if (governedProjectId === null || factTypeKey === null || objectId === null) return null;
  return { governedProjectId, factTypeKey, objectId };
}

function locatorKey(locator: Locator): string {
  // Exact identity: no case folding, no title, no project aliasing.
  return `locator\u0000${locator.governedProjectId}\u0000${locator.factTypeKey}\u0000${locator.objectId}`;
}

/**
 * A UID identity is scoped to a project. UUIDs are globally unique as values,
 * but the projection may carry an explicit resolvedTarget from another governed
 * project; treating the bare UID as the identity would then merge two different
 * projects' objects. A UID without a resolvedTarget defaults to the current
 * project; if the current project id is also empty, resolveIdentity fails closed
 * (identityConflict) and does not use this function.
 */
function uidKey(uid: string, governedProjectId: string): string {
  return `uid\u0000${governedProjectId}\u0000${uid.toLowerCase()}`;
}

function commitKey(commit: string): string {
  return `commit\u0000${commit.toLowerCase()}`;
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const LOCATOR_FIELDS = ['governedProjectId', 'factTypeKey', 'objectId'] as const;
const LOCATOR_FIELD_SET: ReadonlySet<string> = new Set(LOCATOR_FIELDS);

function hasExactLocatorShape(target: Record<string, unknown>): boolean {
  const keys = Object.keys(target);
  return keys.length === LOCATOR_FIELDS.length && keys.every((key) => LOCATOR_FIELD_SET.has(key));
}

function describeTarget(target: unknown): TargetDescription {
  if (!isRecord(target)) return { kind: 'missing' };
  const keys = Object.keys(target);
  // Shape discipline from the fact projection (facts.ts): UID and commit are
  // single-key targets, a locator is exactly its three declared keys. Extra or
  // mixed keys are an illegal legacy shape and must not become an identity.
  if (keys.length === 1 && keys[0] === 'objectUid') {
    const uid = nonEmptyString(target.objectUid);
    // Reuse the shared UUIDv4 authority; lowercasing preserves the existing
    // case-folded UID behavior (specs/03 §6.1), not an arbitrary string.
    return uid !== null && canonicalUid(uid.toLowerCase())
      ? { kind: 'uid', uid }
      : { kind: 'missing' };
  }
  if (keys.length === 1 && keys[0] === 'commit') {
    // Same shape rule as the fact projection: exactly a 40-character hex hash.
    const commit = typeof target.commit === 'string' ? target.commit : '';
    // The renderer opens the raw projected hash; refuse unnormalised values
    // instead of grouping on a trimmed hash and navigating with different text.
    return COMMIT_PATTERN.test(commit) ? { kind: 'commit', commit } : { kind: 'missing' };
  }
  if (!hasExactLocatorShape(target)) return { kind: 'missing' };
  const locator = asLocator(target);
  return locator === null ? { kind: 'missing' } : { kind: 'locator', locator };
}

function associationLocator(association: FactCardAssociation): Locator | null {
  const resolved = asLocator((association as { resolvedTarget?: unknown }).resolvedTarget);
  if (resolved !== null) return resolved;
  const target = describeTarget((association as { target?: unknown }).target);
  return target.kind === 'locator' ? target.locator : null;
}

function meaningOf(entry: Entry): WorkCaseAssociationMeaning {
  if (entry.origin === 'relations') {
    return { kind: 'relation', relationKey: entry.relationKey };
  }
  return entry.origin === 'refs' ? { kind: 'outgoing-ref' } : { kind: 'incoming-ref' };
}

function meaningKey(meaning: WorkCaseAssociationMeaning): string {
  if (meaning.kind === 'relation') {
    return meaning.relationKey === null ? 'relation\u0000' : `relation\u0000${meaning.relationKey}`;
  }
  return meaning.kind;
}

/** Higher score wins; a tie keeps the earliest input entry (stable order). */
function representativeScore(entry: Entry): number {
  let score = 0;
  // "available with a locator" is the preferred display object. Availability is
  // never invented: an unavailable association contributes 0 availability.
  if (entry.association.available === true) score += 2;
  if (entry.locator !== null) score += 1;
  return score;
}

function buildEntries(
  associations: readonly FactCardAssociation[],
  refs: readonly FactCardAssociation[],
  inbound: readonly FactCardAssociation[],
): Entry[] {
  const entries: Entry[] = [];
  let ordinal = 0;
  const append = (association: FactCardAssociation, origin: Origin) => {
    const rawTarget = (association as { target?: unknown }).target;
    const target = describeTarget(rawTarget);
    const relationKey = origin === 'relations' ? association.relationKey ?? null : null;
    const position = ordinal++;
    entries.push({
      association,
      origin,
      relationKey,
      routedTo: origin === 'relations' && relationKey === 'routed-to',
      target,
      locator: associationLocator(association),
      ordinal: position,
    });
  };
  for (const association of associations) append(association, 'relations');
  for (const association of refs) append(association, 'refs');
  for (const association of inbound) append(association, 'inbound');
  return entries;
}

/**
 * Build the UID↔locator index from the entries themselves.
 *
 * Only mappings backed by an actual `resolvedTarget` participate. The caller
 * passes data already scoped to the current project; the project check below is
 * the guard that prevents the projection's optional cross-project locators from
 * being used to merge two different projects' objects.
 */
function buildIdentityIndex(entries: readonly Entry[]): {
  uidToLocators: Map<string, Set<string>>;
  locatorToUids: Map<string, Set<string>>;
  locatorProjects: Map<string, string>;
} {
  const uidToLocators = new Map<string, Set<string>>();
  const locatorToUids = new Map<string, Set<string>>();
  const locatorProjects = new Map<string, string>();
  for (const entry of entries) {
    if (entry.target.kind !== 'uid') continue;
    const resolved = asLocator((entry.association as { resolvedTarget?: unknown }).resolvedTarget);
    if (resolved === null) continue;
    const uid = entry.target.uid.toLowerCase();
    const key = locatorKey(resolved);
    locatorProjects.set(key, resolved.governedProjectId);
    const locators = uidToLocators.get(uid) ?? new Set<string>();
    locators.add(key);
    uidToLocators.set(uid, locators);
    const uids = locatorToUids.get(key) ?? new Set<string>();
    uids.add(uid);
    locatorToUids.set(key, uids);
  }
  return { uidToLocators, locatorToUids, locatorProjects };
}

function identityConflictKey(entry: Entry): string {
  // Every conflicting row is independent, including rows with the same UID text
  // or the same locator. The ordinal is assigned once in buildEntries, so the
  // grouping pass and the inline-pairing pass derive the same stable key.
  return `identity-conflict\u0000${entry.ordinal}`;
}

/**
 * A UID is part of a conflict when it maps to more than one locator or when any
 * locator known for it is claimed by more than one UID. An unresolved UID whose
 * text appears in such a mapping is conflicted too: it cannot be trusted with
 * the ambiguous locator, so it must not be folded into that group.
 */
function uidMappingConflict(uid: string, index: ReturnType<typeof buildIdentityIndex>): boolean {
  const locators = index.uidToLocators.get(uid);
  if (locators === undefined) return false;
  if (locators.size > 1) return true;
  for (const locator of locators) {
    if ((index.locatorToUids.get(locator)?.size ?? 0) > 1) return true;
  }
  return false;
}

/**
 * A locator is part of a conflict when it is claimed by more than one UID or
 * when any claiming UID maps to more than one locator. A directly supplied
 * locator can still be exact, but the overall mapping is ambiguous, so the UI
 * must be told not to present it as a verified clickable identity.
 */
function locatorMappingConflict(
  locator: Locator,
  index: ReturnType<typeof buildIdentityIndex>,
): boolean {
  const key = locatorKey(locator);
  const uids = index.locatorToUids.get(key);
  if (uids === undefined) return false;
  if (uids.size > 1) return true;
  for (const uid of uids) {
    if ((index.uidToLocators.get(uid)?.size ?? 0) > 1) return true;
  }
  return false;
}

function resolveIdentity(
  entry: Entry,
  currentProjectId: string,
  index: ReturnType<typeof buildIdentityIndex>,
): ResolvedIdentity {
  // The UI open paths reuse the current project: fact objects open by
  // objectType/objectId, and commit rows navigate through the current project's
  // changelog. A locator from another project (or an unknown current project)
  // would therefore open a same-shaped object in the wrong project; such rows
  // must be retained but marked non-clickable.
  const currentProjectUnknown = currentProjectId.trim() === '';
  const rawResolved = (entry.association as { resolvedTarget?: unknown }).resolvedTarget;
  const resolvedLocator = asLocator(rawResolved);
  if (rawResolved != null && resolvedLocator === null) {
    return { key: identityConflictKey(entry), identityConflict: true };
  }
  if (entry.target.kind === 'commit') {
    // Commit navigation also depends on the current project. Without one, keep
    // every commit row independent and non-clickable; with one, identical
    // commit hashes are the same known-project target and may merge normally.
    if (currentProjectUnknown || rawResolved != null) {
      return { key: identityConflictKey(entry), identityConflict: true };
    }
    return { key: commitKey(entry.target.commit), identityConflict: false };
  }
  if (entry.target.kind === 'locator') {
    const projectMismatch = currentProjectUnknown
      || entry.target.locator.governedProjectId !== currentProjectId;
    // Rendering resolves a supplied resolvedTarget before the target locator.
    // Do not allow that precedence to redirect an association to a different
    // project or object, or to a malformed locator.
    const locatorMismatch = resolvedLocator !== null
      && locatorKey(resolvedLocator) !== locatorKey(entry.target.locator);
    if (projectMismatch || locatorMismatch || locatorMappingConflict(entry.target.locator, index)) {
      return { key: identityConflictKey(entry), identityConflict: true };
    }
    return { key: locatorKey(entry.target.locator), identityConflict: false };
  }
  if (entry.target.kind === 'missing') {
    // Without a target there is no way to confirm which real edge a leftover
    // resolvedTarget belonged to (it may still be available:true). Keep every
    // such row independent and non-clickable instead of trusting the locator.
    return { key: identityConflictKey(entry), identityConflict: true };
  }

  const uid = entry.target.uid.toLowerCase();
  const resolved = asLocator((entry.association as { resolvedTarget?: unknown }).resolvedTarget);
  const projectMismatch = currentProjectUnknown
    || (resolved !== null && resolved.governedProjectId !== currentProjectId);
  // Project mismatch and ambiguous mappings must never contribute a guessed
  // clickable locator or merge rows with the same UID text; every involved row
  // stays independent with a stable ordinal-based key.
  if (projectMismatch || uidMappingConflict(uid, index)) {
    return { key: identityConflictKey(entry), identityConflict: true };
  }
  // No resolved locator means the row belongs to the current project; an
  // explicit locator keeps its own project dimension even when it conflicts.
  const uidProject = resolved?.governedProjectId ?? currentProjectId;
  const locators = index.uidToLocators.get(uid);
  if (locators !== undefined && locators.size === 1) {
    const [candidate] = locators;
    const uids = index.locatorToUids.get(candidate);
    const locatorProject = index.locatorProjects.get(candidate);
    // Bidirectional uniqueness and no project ambiguity. Otherwise the safe
    // behavior is to keep the UID identity separate from locator identities.
    if (uids !== undefined && uids.size === 1 && locatorProject === currentProjectId) {
      return { key: candidate, identityConflict: false };
    }
  }
  return { key: uidKey(uid, uidProject), identityConflict: false };
}

function groupOf(
  entries: readonly Entry[],
  currentProjectId: string,
): {
  order: string[];
  groups: Map<string, GroupDraft>;
} {
  const index = buildIdentityIndex(entries);
  const groups = new Map<string, GroupDraft>();
  const order: string[] = [];
  for (const entry of entries) {
    const identity = resolveIdentity(entry, currentProjectId, index);
    const key = identity.key;
    let group = groups.get(key);
    if (group === undefined) {
      const score = representativeScore(entry);
      group = {
        key,
        members: [],
        meanings: [],
        meaningKeys: new Set<string>(),
        representative: entry,
        representativeScore: score,
        identityConflict: identity.identityConflict,
      };
      groups.set(key, group);
      order.push(key);
    } else {
      const score = representativeScore(entry);
      if (score > group.representativeScore) {
        group.representative = entry;
        group.representativeScore = score;
      }
    }
    group.members.push(entry);
    const meaning = meaningOf(entry);
    const mKey = meaningKey(meaning);
    if (!group.meaningKeys.has(mKey)) {
      group.meaningKeys.add(mKey);
      group.meanings.push(meaning);
    }
  }
  return { order, groups };
}

/**
 * Merge one WorkCase's association projections into display groups.
 *
 * Pairing semantics (21 §12 + the current `facts.ts` projection):
 * `routed-to` may repeat the same target in the source, but the backend
 * projection deduplicates relations by target. The number of surviving
 * `routed-to` rows can therefore be smaller than the number of advice rows, and
 * no mechanical information says which advice row lost its target. Pairing is
 * only attempted when the two counts are exactly equal. On a mismatch every
 * `routed-to` stays in `other`, `inline` is all null, and `pairingMismatch` is
 * true so the UI can report the gap instead of attaching a target to the wrong
 * advice row. Nothing is synthesized or re-read.
 *
 * When counts match, slot k receives the group of the k-th `routed-to` relation,
 * in the original `associations` order; a group already shown in an earlier
 * slot is suppressed (null) rather than repeated. Every non-inline group stays
 * in `other`, preserving first-seen input order.
 */
export function groupWorkCaseAssociations(
  associations: readonly FactCardAssociation[],
  refs: readonly FactCardAssociation[],
  inbound: readonly FactCardAssociation[],
  sparkAdviceCount: number,
  currentProjectId: string,
): {
  inline: Array<WorkCaseAssociationGroup | null>;
  other: WorkCaseAssociationGroup[];
  pairingMismatch: boolean;
} {
  const entries = buildEntries(associations, refs, inbound);
  const { order, groups } = groupOf(entries, currentProjectId);

  const slotCount = Number.isFinite(sparkAdviceCount)
    ? Math.max(0, Math.floor(sparkAdviceCount))
    : 0;
  const routedToEntries = entries.filter((entry) => entry.routedTo);
  const index = buildIdentityIndex(entries);

  const inlineByKey = new Map<string, number>();
  const inline: Array<WorkCaseAssociationGroup | null> = Array.from({ length: slotCount }, () => null);
  // The backend projection dedupes routed-to by target, so an unequal count
  // means at least one advice row's target is not mechanically recoverable.
  const pairingMismatch = routedToEntries.length !== slotCount;
  if (!pairingMismatch) {
    for (let slot = 0; slot < slotCount; slot += 1) {
      const key = resolveIdentity(routedToEntries[slot], currentProjectId, index).key;
      if (inlineByKey.has(key)) continue;
      inlineByKey.set(key, slot);
    }
  }

  const other: WorkCaseAssociationGroup[] = [];
  const toGroup = (draft: GroupDraft, inlineIndex: number | null): WorkCaseAssociationGroup => ({
    key: draft.key,
    association: draft.representative.association,
    meanings: draft.meanings,
    inlineIndex,
    identityConflict: draft.identityConflict,
  });

  for (const key of order) {
    const draft = groups.get(key);
    if (draft === undefined) continue;
    const slot = inlineByKey.get(key);
    if (slot !== undefined) {
      inline[slot] = toGroup(draft, slot);
    } else {
      other.push(toGroup(draft, null));
    }
  }

  return { inline, other, pairingMismatch };
}
