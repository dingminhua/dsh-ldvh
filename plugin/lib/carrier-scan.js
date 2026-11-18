
import { readdir } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { join } from "node:path";

export const EXCLUDED_NAME_MARKER =
  /\.(draft|tmp|temp|bak|backup|orig|swp|swo)$|~$|\.draft\.|\.tmp\.|\.temp\.|\.bak\.|\.orig\./;

export function isExcludedCarrierName(name) {
  const withoutExtension = name.endsWith(".md") ? name.slice(0, -3) : name;
  return EXCLUDED_NAME_MARKER.test(name) || EXCLUDED_NAME_MARKER.test(withoutExtension);
}

const READABLE_ID_SEGMENT =
  "(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})";

export function readableCarrierNamePattern(type) {
  return new RegExp(`^${type}-${READABLE_ID_SEGMENT}\\.md$`, "i");
}

function identitySegmentOf(type, name) {
  return name.slice(type.length + 1, name.length - ".md".length);
}

export function declaredObjectUid(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return null;
  const line = fm[1].match(/^object_uid:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m);
  return line ? line[1] : null;
}

export async function scanCarrierDirectory(typeDir, type, { read } = {}) {
  const readFileImpl = read ?? (await import("node:fs/promises")).readFile;
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { carriers: [], invalid: [], missing: true };
    throw error;
  }

  const pattern = readableCarrierNamePattern(type);
  const carriers = [];
  const invalid = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (isExcludedCarrierName(entry.name)) continue;
    if (!entry.name.endsWith(".md")) continue;

    const nameUid = pattern.test(entry.name) ? identitySegmentOf(type, entry.name) : null;
    let content;
    try {
      content = await readFileImpl(join(typeDir, entry.name), "utf8");
    } catch (error) {
      invalid.push({ file: entry.name, reason: `unreadable: ${error.message}` });
      continue;
    }

    if (nameUid === null) {
      invalid.push({
        file: entry.name,
        reason: `filename does not match the carrier pattern for ${type} (expected ${type}-<uuid>.md)`,
      });
      continue;
    }

    const uid = declaredObjectUid(content);
    if (uid === null) {
      const fmBlock = content.match(/^---\n([\s\S]*?)\n---\n/);
      let parsedMapping = null;
      if (fmBlock) {
        try {
          const value = parseYaml(fmBlock[1]);
          if (value !== null && typeof value === "object" && !Array.isArray(value)) parsedMapping = value;
        } catch {
          parsedMapping = null;
        }
      }
      if (parsedMapping !== null) {
        invalid.push({
          file: entry.name,
          reason: "no object_uid declared in frontmatter (the carrier cannot be identified)",
        });
        continue;
      }
      carriers.push({ file: entry.name, uid: nameUid, nameUid, content, identityUnverified: true });
      continue;
    }

    if (uid.toLowerCase() !== nameUid.toLowerCase()) {
      invalid.push({
        file: entry.name,
        reason:
          `object_uid ${JSON.stringify(uid)} does not match the filename's identity segment ${JSON.stringify(nameUid)} `
          + "— one of the two is wrong; listed under the declared identity",
      });
    }

    carriers.push({ file: entry.name, uid, nameUid, content });
  }

  return { carriers, invalid, missing: false };
}
