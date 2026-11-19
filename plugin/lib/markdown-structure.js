
export function normalizeNewlines(text) {
  return String(text).replace(/\r\n?/g, "\n");
}

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

export function h2Titles(body) {
  return atxHeadings(body, 2);
}

export function countAtxHeadings(body, level) {
  return atxHeadings(body, level).length;
}

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
