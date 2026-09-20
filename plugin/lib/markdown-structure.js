/**
 * dsh-ldvh — markdown 正文结构的单一权威实现（specs/09 §5 同族纪律）
 *
 * 背景：本模块收敛的是**同一判定在多层各自实现**的缺陷族。pitfall
 * `e8cadde1`（身份判定散落 4 处、3 处取错版本位，致关联全量判死）是同一
 * 病因在 object_uid 判定上的实例；本模块处理它在 markdown 结构解析上的
 * 复发——`h2Titles` / `sectionContent` / `countAtxHeadings` 曾在 6 个
 * writer 中各自实现，且**同一文件内两个函数对代码围栏的处理不一致**：
 * spark/pitfall 的 `h2Titles` 不跳围栏，而同文件的 `countAtxHeadings` 跳，
 * 于是围栏内的 `## 假标题` 被前者当成真 H2（pitfall `96fb3199` 的判定单位
 * 问题在集合性质上的同族形态）。
 *
 * 统一语义（全部函数共用，不得各自分叉）：
 *   1. 行尾归一：`\r\n` 与裸 `\r` 一律视为 `\n`（CRLF 载体与 LF 载体等价）；
 *   2. ATX 标题按 CommonMark 识别：≤3 前导空格、井号后须有空格或 tab、
 *      容忍尾随空白；`#标题`（井号后无空格）**不是**标题；
 *   3. fenced code block（``` 或 ~~~ 配对）内的行一律不计入结构——
 *      围栏内的 `#`/`##` 是字面内容，不是标题；
 *   4. 围栏配对按同种标记闭合（``` 不因 ~~~ 关闭，反之亦然），与
 *      CommonMark 的 fenced code block 规则一致。
 *
 * 未覆盖（如实声明，不得据本模块声称已覆盖）：setext 标题（下划线式）、
 * 行内代码与 HTML 注释中的 `#`。若载体格式扩展到这些形态，须同步扩展本
 * 模块而非在各 writer 内另立实现。
 */

/** 行尾归一：CRLF / CR → LF。所有结构解析的公共第一步。 */
export function normalizeNewlines(text) {
  return String(text).replace(/\r\n?/g, "\n");
}

/**
 * 逐行遍历正文，跳过 fenced code block 内的行。
 * `visit(line)` 返回 false 可提前终止遍历。
 * 这是全部结构解析的公共底座——跳过围栏的判定只有这一处。
 */
function forEachStructuralLine(body, visit) {
  const lines = normalizeNewlines(body).split("\n");
  let fence = null;
  for (const line of lines) {
    const fenceMatch = /^ {0,3}(```|~~~)/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (visit(line) === false) return;
  }
}

/**
 * 提取指定层级的 ATX 标题文本（按出现顺序）。
 * 围栏内的同形行不计入（CommonMark fenced code block 语义）。
 */
export function atxHeadings(body, level) {
  const hashes = "#".repeat(level);
  const pattern = new RegExp(`^ {0,3}${hashes}(?!#)[ \\t]+(.+?)[ \\t]*$`);
  const out = [];
  forEachStructuralLine(body, (line) => {
    const m = pattern.exec(line);
    if (m !== null) out.push(m[1].trim());
  });
  return out;
}

/** H2 标题文本列表（`atxHeadings(body, 2)` 的具名封装）。 */
export function h2Titles(body) {
  return atxHeadings(body, 2);
}

/** 统计指定层级的 ATX 标题数量（集合性质判定，替代首行比较式校验）。 */
export function countAtxHeadings(body, level) {
  return atxHeadings(body, level).length;
}

/**
 * 取某个 H2 节的正文内容（该 H2 行之后、下一个 H2 行之前）。
 * 节不存在时返回 null——调用方据此区分「节缺失」与「节为空」，
 * 不得把两者混同（节缺失常由载体结构校验另行拒绝）。
 *
 * 注意：本函数按 CommonMark 语意识别 H2 边界，因此围栏内的 `## ` 行
 * **不会**被误当作节边界（旧实现中 5 份变体会在此处截断节内容）。
 */
export function sectionContent(body, h2Title) {
  const lines = normalizeNewlines(body).split("\n");
  const target = String(h2Title).trim();
  let inFence = false;
  let fenceMarker = "";
  let collecting = false;
  const out = [];
  for (const line of lines) {
    const fenceMatch = /^ {0,3}(```|~~~)/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1];
      if (!inFence) { inFence = true; fenceMarker = marker; }
      else if (marker === fenceMarker) { inFence = false; fenceMarker = ""; }
      if (collecting) out.push(line);
      continue;
    }
    if (!inFence) {
      const m = /^ {0,3}##[ \t]+(.+?)[ \t]*$/.exec(line);
      if (m !== null) {
        const title = m[1].trim();
        if (collecting) return out.join("\n").trim();
        if (title === target) { collecting = true; continue; }
      }
    }
    if (collecting) out.push(line);
  }
  return collecting ? out.join("\n").trim() : null;
}

/**
 * 取某个 H2 节内的 H3 标题列表（research 探索型的四段结构校验用）。
 * 节不存在或无 H3 时返回空数组——调用方按长度判定，不区分这两种情形
 * （沿用原实现语义：节缺失由 H2 完整性校验另行拒绝）。
 */
export function h3TitlesInSection(body, h2Title) {
  const target = String(h2Title).trim();
  let inSection = false;
  const out = [];
  forEachStructuralLine(body, (line) => {
    const h2 = /^ {0,3}##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (h2 !== null) {
      inSection = h2[1].trim() === target;
      return;
    }
    if (!inSection) return;
    const h3 = /^ {0,3}###(?!#)[ \t]+(.+?)[ \t]*$/.exec(line);
    if (h3 !== null) out.push(h3[1].trim());
  });
  return out;
}
