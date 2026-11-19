
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
  if (m === null) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] === undefined ? null : m[4].split("."),
  };
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null) throw new Error(`host-version: 无法解析版本号 ${JSON.stringify(a)}`);
  if (pb === null) throw new Error(`host-version: 无法解析版本号 ${JSON.stringify(b)}`);
  for (const f of ["major", "minor", "patch"]) {
    if (pa[f] !== pb[f]) return pa[f] < pb[f] ? -1 : 1;
  }
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  const la = pa.prerelease.length;
  const lb = pb.prerelease.length;
  for (let i = 0; i < Math.max(la, lb); i += 1) {
    if (i >= la) return -1;
    if (i >= lb) return 1;
    const ia = pa.prerelease[i];
    const ib = pb.prerelease[i];
    const na = /^\d+$/.test(ia) ? Number(ia) : null;
    const nb = /^\d+$/.test(ib) ? Number(ib) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (na !== null) {
      return -1;
    } else if (nb !== null) {
      return 1;
    } else if (ia !== ib) {
      return ia < ib ? -1 : 1;
    }
  }
  return 0;
}

export function tagVersion(tag) {
  const m = /^(?:dsh-)?v?(\d+\.\d+\.\d+(?:-.+)?)$/.exec(tag.trim());
  if (m === null) throw new Error(`host-version: 无法从 tag ${JSON.stringify(tag)} 解析版本号`);
  return m[1];
}

export function inInterval(v, base, target) {
  return compareVersions(v, base) > 0 && compareVersions(v, target) <= 0;
}
