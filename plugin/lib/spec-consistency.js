const FIELD_ROW = /^\|\s*`([a-z_]+)`\s*\|/;
const SECTION_REF = /(\d{2})?\s*§(\d+(?:\.\d+)*)/g;
const HEADING_NUMBER = /^#{2,3}\s+(\d+(?:\.\d+)*)\.?\s/;

export function specSectionText(specText, headingPrefix) {
  const lines = specText.split("\n");
  const start = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

export function specFieldRows(specText) {
  const rows = [];
  for (const line of specText.split("\n")) {
    const match = FIELD_ROW.exec(line);
    if (match === null) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const fieldIndex = cells.indexOf(`\`${match[1]}\``);
    if (fieldIndex === -1) continue;
    rows.push({ field: match[1], requiredCell: cells[fieldIndex + 2] ?? "" });
  }
  return rows;
}

export function headingNumbers(markdown) {
  const numbers = new Set();
  for (const line of markdown.split("\n")) {
    const match = HEADING_NUMBER.exec(line);
    if (match === null) continue;
    numbers.add(match[1].replace(/\.$/, ""));
  }
  return numbers;
}

export function codeAssignedFields(schemaDescription) {
  const match = /Code assigns ([A-Za-z_/]+)/.exec(schemaDescription);
  if (match === null) return [];
  return match[1].split("/").map((name) => name.trim()).filter((name) => name.length > 0);
}

export function fieldContractIssues({ specText, schema, inputOnlyFields = [], sectionHeading = "## 8. 字段契约" }) {
  const issues = [];
  const rows = specFieldRows(specSectionText(specText, sectionHeading));
  if (rows.length === 0) {
    issues.push("字段契约表未解析到任何字段行");
    return { issues, unconditionallyRequired: [], unconditionalInSchema: [] };
  }
  const codeAssigned = new Set(codeAssignedFields(schema.description ?? ""));
  const specFields = rows.map((row) => row.field);
  const schemaKeys = Object.keys(schema.properties ?? {});
  const expected = specFields.filter((field) => !codeAssigned.has(field));
  for (const field of inputOnlyFields) {
    if (!expected.includes(field)) expected.push(field);
  }
  const missingInSchema = expected.filter((field) => !schemaKeys.includes(field));
  for (const field of missingInSchema) {
    issues.push(`规范字段表有 ${field}，写入口 schema 无此字段`);
  }
  const extraInSchema = schemaKeys.filter((field) => !expected.includes(field));
  for (const field of extraInSchema) {
    issues.push(`写入口 schema 有 ${field}，规范字段表无此字段`);
  }
  const requiredCells = new Map(rows.map((row) => [row.field, row.requiredCell]));
  const specRequired = specFields.filter((field) => {
    const cell = requiredCells.get(field) ?? "";
    return cell === "必填" || cell.includes("必填");
  });
  const schemaRequired = schema.required ?? [];
  for (const field of schemaRequired) {
    if (!specRequired.includes(field)) {
      issues.push(`写入口 schema 把 ${field} 列为 required，但规范字段表未标必填`);
    }
  }
  const unconditionallyRequired = specFields.filter((field) => {
    if (codeAssigned.has(field)) return false;
    return (requiredCells.get(field) ?? "") === "必填";
  });
  const unconditionalInSchema = unconditionallyRequired.filter((field) => schemaRequired.includes(field));
  return { issues, unconditionallyRequired, unconditionalInSchema };
}

export function guidanceAnchorIssues({
  guidance,
  anchorBlockStart,
  anchorBlockEnd,
  anchorSpecNumber,
  anchorSpecText,
  requiredAnchorsText,
  requiredAnchorsMarker,
  specsByNumber,
  mode = "dev",
}) {
  const issues = [];

  if (mode !== "dev") return issues;
  const start = guidance.indexOf(anchorBlockStart);
  if (start === -1) {
    issues.push("引导文本中未找到工作锚点块起始标记");
    return issues;
  }
  const end = guidance.indexOf(anchorBlockEnd, start);
  if (end === -1) {
    issues.push("引导文本中未找到工作锚点块结束标记");
    return issues;
  }
  const block = guidance.slice(start, end);
  const anchorNumbers = headingNumbers(anchorSpecText);
  const specNumbers = new Map();
  for (const [number, text] of Object.entries(specsByNumber)) {
    specNumbers.set(number, headingNumbers(text));
  }
  const collect = (text) => {
    const found = [];
    let lastSpec = null;
    let previousEnd = -1;
    for (const match of text.matchAll(SECTION_REF)) {
      const between = previousEnd === -1 ? "" : text.slice(previousEnd, match.index);
      const inherits = match[1] === undefined && lastSpec !== null && /[／/]/.test(between);
      const spec = match[1] ?? (inherits ? lastSpec : anchorSpecNumber);
      if (match[1] !== undefined) lastSpec = match[1];
      found.push({ spec, section: match[2] });
      previousEnd = match.index + match[0].length;
    }
    return found;
  };
  for (const reference of collect(block)) {
    const target = reference.spec === anchorSpecNumber
      ? anchorNumbers
      : specNumbers.get(reference.spec);
    if (target === undefined) {
      issues.push(`引导工作锚点块引用了不存在的规范 ${reference.spec}`);
      continue;
    }
    if (!target.has(reference.section)) {
      issues.push(`引导工作锚点块引用 ${reference.spec} §${reference.section}，该节不存在`);
    }
  }
  for (const reference of collect(guidance.slice(end))) {
    const target = specNumbers.get(reference.spec);
    if (target === undefined) {
      issues.push(`引导正文引用了不存在的规范 ${reference.spec}`);
      continue;
    }
    if (!target.has(reference.section)) {
      issues.push(`引导正文引用 ${reference.spec} §${reference.section}，该节不存在`);
    }
  }
  const markerIndex = requiredAnchorsText.indexOf(requiredAnchorsMarker);
  if (markerIndex === -1) {
    issues.push("规范中未找到最小规则引导的锚点清单标记");
    return issues;
  }
  const requiredText = requiredAnchorsText.slice(markerIndex + requiredAnchorsMarker.length).split("\n")[0];
  const requiredRefs = [];
  for (const match of requiredText.matchAll(SECTION_REF)) {
    requiredRefs.push({ spec: match[1] ?? anchorSpecNumber, section: match[2] });
  }
  const guidanceRefs = new Set(collect(guidance).map((reference) => `${reference.spec} §${reference.section}`));
  for (const reference of requiredRefs) {
    const key = `${reference.spec} §${reference.section}`;
    if (!guidanceRefs.has(key)) {
      issues.push(`01 §10.4 要求的锚点 ${key} 未出现在引导文本中`);
    }
  }
  const requiredKeywords = ["身份块"];
  for (const keyword of requiredKeywords) {
    if (!requiredText.includes(keyword)) {
      issues.push(`01 §10.4 的锚点清单未含关键词 ${keyword}`);
      continue;
    }
    if (!guidance.includes(keyword)) {
      issues.push(`01 §10.4 要求的锚点 ${keyword} 未出现在引导文本中`);
    }
  }
  return issues;
}
