function signatureIdentityKey(name) {
    return name.replace(/[\s_-]/g, '').toLocaleLowerCase();
}
function normalizeModelName(value) {
    if (typeof value !== 'string')
        return '';
    const trimmed = value.trim();
    if (!trimmed)
        return '';
    const model = trimmed.slice(trimmed.lastIndexOf('/') + 1).trim();
    return model.replace(/(?:\s*\[[^[\]]*\]\s*)+$/, '').trim();
}
function normalizeProductName(value) {
    if (typeof value !== 'string')
        return '';
    const trimmed = value.trim();
    if (!trimmed)
        return '';
    if (signatureIdentityKey(trimmed) === 'deepseekharness')
        return 'DeepSeek Harness';
    if (signatureIdentityKey(trimmed) === 'codexdesktop')
        return 'Codex';
    if (signatureIdentityKey(trimmed).includes('trae'))
        return 'Trae';
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}
export function normalizeSignature(value) {
    const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
    const model = typeof value.model === 'string' ? value.model.trim() : '';
    return {
        productName: provider || normalizeProductName(value.productName),
        modelName: normalizeModelName(model || value.modelName),
    };
}
