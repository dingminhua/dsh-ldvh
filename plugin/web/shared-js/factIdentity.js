const CANONICAL_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function canonicalUid(value) {
    return typeof value === 'string' && CANONICAL_UID_PATTERN.test(value);
}
