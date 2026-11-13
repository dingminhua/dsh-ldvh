/**
 * Fact-object identifier parsing.
 *
 * ## 为什么需要它
 *
 * Web 界面「复制对象引用」产出 `{projectId}@<objectId>`（见
 * `plugin/web/src/utils/objectReference.ts`），其中 `objectId` 是载体文件名去掉
 * `.md`，故实际值是 `dsh-ldvh@friction-07ef92cf-1577-40af-aecf-69d06273fd92`。
 * 而 `02 §9.3` 规定的最小指称形态是「类型短名 + 短标识」（`friction-07ef92cf`）。
 * 加上裸 UUID 与 `type-<完整uuid>`，模型面会遇到四种写法。
 *
 * 此前九个 `*-writer.js` 各自持有一份 UUIDv4 正则，**只认裸 UUID**，其余三种一律
 * `invalid_uid`。于是从界面复制的引用在工具面不可用——AI 拿到它无法定位对象。
 *
 * ## 两层的分界（本模块只做第一层）
 *
 * - **纯形态解析**（本模块）：字符串 → `{type?, uuid?, hex?}`。不读任何文件、
 *   不触达事实源、同一输入恒得同一输出。这一层可独立成立并独立测试。
 * - **载体反查**（调用方）：拿短标识去事实源里找唯一载体。它必然依赖事实源，
 *   与第一层不是同一个保证等级——分开实现、分开声明。
 *
 * ## 边界
 *
 * 解析成功**不等于**对象存在：本模块只回答「这个串声明了什么身份」，不回答
 * 「该对象是否存在、是否可读」。存在性由读取入口在解析之后自查。
 *
 * 类型前缀与真实类型不符时，本层无法判断（它不知道事实源里有什么），故只把
 * 声明的类型原样带出，由调用方在找到载体后比对——不符则拒绝，不静默改判。
 */

import { __FACT_TYPE_KEYS_FOR_TEST } from "./object-reference.js";

/** 类型短名闭集（与 `object-reference.js` 同源，不另立一份）。 */
const FACT_TYPE_KEYS = __FACT_TYPE_KEYS_FOR_TEST;

/** canonical UUIDv4（03 §6.1：版本位 4，变体位 8/9/a/b）。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 短标识：`object_uid` 的前 8 位小写十六进制（02 §9.3 第 1 条）。 */
const SHORT_ID_PATTERN = /^[0-9a-f]{8}$/i;

/** `<type>-<body>` 的拆分点：第一个连字符。 */
const TYPE_PREFIXED = /^([a-z][a-z0-9]*)-(.+)$/;

/** `{projectId}@{rest}` 的拆分点：第一个 `@`。 */
const PROJECT_SCOPED = /^([^@]+)@(.+)$/;

/**
 * 解析失败的原因码（闭集，供调用方映射到各自的错误码）。
 *
 * 分开而不是合成一个 `invalid`：调用方要据此告诉模型「该怎么改」——是形态写错
 * 了，还是项目前缀与当前会话不符，还是短标识撞了多个对象。
 */
export const IDENTIFIER_ERRORS = Object.freeze({
  MALFORMED: "malformed",              // 不是四种书写形态中的任何一种
  UNKNOWN_TYPE: "unknown_type",        // 带类型前缀，但词干不在 fact_type_key 值域内
  FOREIGN_PROJECT: "foreign_project",  // 带项目前缀，但不是当前项目
  AMBIGUOUS: "ambiguous",              // 短标识命中多个载体
  NOT_FOUND: "not_found",              // 短标识在事实源内无对应载体
});

function fail(code, detail) {
  return { ok: false, error: { code, ...detail } };
}

function ok(fields) {
  return { ok: true, value: fields };
}

/**
 * **纯形态解析**：把四种书写形态拆成身份字段。不读文件、不查事实源。
 *
 * @param {string} input 用户/AI 提供的标识串。
 * @returns {{ok: true, value: {objectUid?: string, shortId?: string, declaredType?: string, projectId?: string}}
 *          | {ok: false, error: {code: string, message: string, ...}}}
 *
 * 返回值语义：
 * - `objectUid` 与 `shortId` **恰有一个**存在——前者是可直接使用的 canonical 标识，
 *   后者还须经调用方做载体反查。
 * - `declaredType` 只在输入带类型前缀时出现；它**未经核实**，调用方找到载体后
 *   必须比对真实类型，不符即拒绝（不得静默改判）。
 * - `projectId` 只在输入带项目前缀时出现。
 */
export function parseObjectIdentifier(input) {
  if (typeof input !== "string") {
    return fail(IDENTIFIER_ERRORS.MALFORMED, { message: "identifier must be a string" });
  }
  const raw = input.trim();
  if (raw.length === 0) {
    return fail(IDENTIFIER_ERRORS.MALFORMED, { message: "identifier must not be empty" });
  }

  // 形态 4：`{projectId}@{rest}` —— 先剥项目前缀，其余按下面的形态再解析。
  // 只剥一层：项目 id 里不允许 `@`（governed-projects.yaml 的 id 形态），故第一个
  // `@` 即是分界；`rest` 里若还含 `@`，会落到后续形态判定并因不合形态而失败。
  const projectMatch = raw.match(PROJECT_SCOPED);
  const projectId = projectMatch === null ? undefined : projectMatch[1];
  const body = projectMatch === null ? raw : projectMatch[2];

  // 形态 1：裸 UUID。
  if (UUID_PATTERN.test(body)) {
    return ok({ objectUid: body.toLowerCase(), ...(projectId === undefined ? {} : { projectId }) });
  }

  // 形态 2/3：`<type>-<uuid>` 或 `<type>-<8hex>`。
  const prefixed = body.match(TYPE_PREFIXED);
  if (prefixed !== null) {
    const [, type, rest] = prefixed;
    if (!FACT_TYPE_KEYS.has(type)) {
      return fail(IDENTIFIER_ERRORS.UNKNOWN_TYPE, {
        message: `"${type}" is not a registered fact_type_key (02 §7.1)`,
        declared_type: type,
      });
    }
    if (UUID_PATTERN.test(rest)) {
      return ok({ objectUid: rest.toLowerCase(), declaredType: type, ...(projectId === undefined ? {} : { projectId }) });
    }
    if (SHORT_ID_PATTERN.test(rest)) {
      return ok({ shortId: rest.toLowerCase(), declaredType: type, ...(projectId === undefined ? {} : { projectId }) });
    }
    return fail(IDENTIFIER_ERRORS.MALFORMED, {
      message: `"${rest}" is neither a canonical UUIDv4 nor an 8-hex short id`,
      declared_type: type,
    });
  }

  // 形态 3 的裸短标识：`<8hex>`。02 §9.3 明说裸短标识不构成可读的最小形态，
  // 但它仍是明确的机器可解析输入，且本模块有类型信息可查——故接受，由调用方
  // 在反查后决定是否补类型。不接受则界面上复制的短形态永远用不了。
  if (SHORT_ID_PATTERN.test(body)) {
    return ok({ shortId: body.toLowerCase(), ...(projectId === undefined ? {} : { projectId }) });
  }

  return fail(IDENTIFIER_ERRORS.MALFORMED, {
    message: "expected one of: canonical UUIDv4, <type>-<uuid>, <type>-<8hex>, {projectId}@<one of those>",
  });
}

/** 供测试与调用方判断某个类型短名是否已登记。 */
export function isRegisteredFactType(typeKey) {
  return typeof typeKey === "string" && FACT_TYPE_KEYS.has(typeKey);
}

// ---------------------------------------------------------------------------
// 载体反查（第二层：依赖事实源）
// ---------------------------------------------------------------------------

/**
 * 类型短名 → 事实源子目录名。
 *
 * **与 `plugin/lib/*-writer.js` 的 `*_DIRECTORY` 常量逐项相等**——那九个常量才是
 * 各自的权威定义，此处只是把它们集中成一张查询表供按类型枚举用。漂移时以 writer
 * 为准：本表被 `object-identifier.test.mjs` 钉住与九个常量一致。
 */
export const FACT_TYPE_DIRECTORIES = Object.freeze({
  adr: "adrs",
  devlog: "devlogs",
  friction: "frictions",
  norm: "norms",
  pitfall: "pitfalls",
  research: "researches",
  spark: "sparks",
  subgoal: "subgoals",
});

/** 载体文件名形如 `<type>-<uuid>.md`；只取 uuid 部分比对短标识。 */
const CARRIER_NAME = /^([a-z]+)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i;

/**
 * 用 8 位短标识在事实源里反查唯一 `object_uid`。
 *
 * **这一层必然依赖事实源**：它要读目录、要比对文件名。故与 `parseObjectIdentifier`
 * 分开——后者不读任何文件，前者做不到。
 *
 * 每次现扫，**不建持久索引**：索引会引入一份可与载体漂移的第二权威，而现扫 350
 * 个文件名的实测开销在毫秒级。碰撞时返回全部候选并拒绝，不自动裁决——`02 §9.3`
 * 第 4 条明说前缀碰撞无机械检测能力，那正是要在这里显式暴露的。
 *
 * @param {{factSourceRoot: string, shortId: string, declaredType?: string}} args
 * @param {{readdir?: Function}} [deps] 注入用；生产不传。
 * @returns {Promise<{ok: true, value: {objectUid: string, factTypeKey: string}}
 *          | {ok: false, error: {code: string, message: string, candidates?: string[]}}>}
 */
export async function resolveShortId({ factSourceRoot, shortId, declaredType }, deps = {}) {
  const readdir = deps.readdir ?? (await import("node:fs/promises")).readdir;
  const dirs = declaredType === undefined
    ? Object.entries(FACT_TYPE_DIRECTORIES)
    : Object.entries(FACT_TYPE_DIRECTORIES).filter(([type]) => type === declaredType);
  if (declaredType !== undefined && dirs.length === 0) {
    return fail(IDENTIFIER_ERRORS.UNKNOWN_TYPE, {
      message: `"${declaredType}" is not a registered fact_type_key (02 §7.1)`,
      declared_type: declaredType,
    });
  }

  const hits = [];
  for (const [factTypeKey, directory] of dirs) {
    let entries;
    try {
      entries = await readdir(`${factSourceRoot}/${directory}`);
    } catch (error) {
      // 目录不存在（该类型尚无对象）不是错误——按空集继续，其余目录照查。
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const name of entries) {
      const match = name.match(CARRIER_NAME);
      if (match === null) continue;
      const [, fileType, uuid] = match;
      // 文件名自带的类型前缀与目录不一致时以目录为准：目录是写入侧的权威位置，
      // 文件名只是约定。但该情形本身可疑，仍按实际命中的目录归属。
      if (uuid.slice(0, 8).toLowerCase() !== shortId.toLowerCase()) continue;
      hits.push({ objectUid: uuid.toLowerCase(), factTypeKey, carrierType: fileType, file: name });
    }
  }

  if (hits.length === 0) {
    return fail(IDENTIFIER_ERRORS.NOT_FOUND, {
      message: `no carrier in this project matches short id "${shortId}"`
        + (declaredType === undefined ? "" : ` under type "${declaredType}"`),
      short_id: shortId,
    });
  }
  if (hits.length > 1) {
    return fail(IDENTIFIER_ERRORS.AMBIGUOUS, {
      message: `short id "${shortId}" matches ${hits.length} carriers; use the full object_uid instead `
        + "(02 §9.3 第 4 条: 短标识只在同一文本内至多指一个对象时使用)",
      short_id: shortId,
      candidates: hits.map((hit) => `${hit.factTypeKey}-${hit.objectUid}`),
    });
  }
  const [hit] = hits;
  return ok({ objectUid: hit.objectUid, factTypeKey: hit.factTypeKey });
}
