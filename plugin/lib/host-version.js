// dsh-ldvh — DSH 宿主版本序比较。
//
// Authority: Norm `host-upgrade-followup` (norm-e188af99) 第 3 步的区间筛选。
// 差分器要枚举「版本序落在 (基线, 目标] 的 upgrade-guide」——但上游把 guide
// **事后回填**到最新 tree（实测：subagent-activations/guide.md 在 dsh-v0.2.1-alpha.1
// tag 当时不存在，是回填到 alpha.2+ 的 tree 的）。故不能用 `git diff base..target`
// 的「新增文件」判区间（那读的是 targetTag 当时的 tree，漏掉回填），而应：从最新
// tree 枚举全部 guide 版本目录，再按**版本号**筛 (base, target]。这需要一个正确的
// semver 预发布序比较器——alpha < rc、无预发布(正式版) > 任何预发布。
//
// 只覆盖 DSH 的版本形态 `major.minor.patch[-prerelease]`，prerelease 为
// `alpha.N` / `rc.N`（点分标识符，字母序 alpha<rc，数字按数值）。不建通用 semver
// 抽象（specs/10 §11 反过度设计红线）。

/** 解析 DSH 版本号；形态不符返回 null（调用方 fail-closed，不猜）。 */
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

/**
 * 比较两个 DSH 版本号。返回 <0 / 0 / >0。
 * @throws 任一版本号形态不符（fail-closed，不静默当相等）
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null) throw new Error(`host-version: 无法解析版本号 ${JSON.stringify(a)}`);
  if (pb === null) throw new Error(`host-version: 无法解析版本号 ${JSON.stringify(b)}`);
  for (const f of ["major", "minor", "patch"]) {
    if (pa[f] !== pb[f]) return pa[f] < pb[f] ? -1 : 1;
  }
  // 预发布序：无预发布（正式版）> 有预发布
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  const la = pa.prerelease.length;
  const lb = pb.prerelease.length;
  for (let i = 0; i < Math.max(la, lb); i += 1) {
    if (i >= la) return -1; // a 标识符更少 = 更小（alpha.1 < alpha.1.2）
    if (i >= lb) return 1;
    const ia = pa.prerelease[i];
    const ib = pb.prerelease[i];
    const na = /^\d+$/.test(ia) ? Number(ia) : null;
    const nb = /^\d+$/.test(ib) ? Number(ib) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (na !== null) {
      return -1; // 数字标识符 < 字母标识符（semver 规则）
    } else if (nb !== null) {
      return 1;
    } else if (ia !== ib) {
      return ia < ib ? -1 : 1; // 字母序：alpha < rc
    }
  }
  return 0;
}

/**
 * 从 `dsh-v<version>` tag 名或裸版本号取版本号字符串。
 * @throws 形态不符（fail-closed）
 */
export function tagVersion(tag) {
  const m = /^(?:dsh-)?v?(\d+\.\d+\.\d+(?:-.+)?)$/.exec(tag.trim());
  if (m === null) throw new Error(`host-version: 无法从 tag ${JSON.stringify(tag)} 解析版本号`);
  return m[1];
}

/**
 * 版本号 v 是否落在区间 (base, target]（严格大于 base、小于等于 target）。
 * @throws 任一版本号形态不符
 */
export function inInterval(v, base, target) {
  return compareVersions(v, base) > 0 && compareVersions(v, target) <= 0;
}
