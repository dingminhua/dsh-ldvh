
import { sectionContent } from "./markdown-structure.js";

const POSITIONING_SECTION_TITLE = "方向定位与适用范围";

const POSITIONING_MAX_CHARS = 60;

const AUTHORIZATION_WORDING = /无须.*请示|无需.*请示|不必.*请示|免予.*请示|免于.*请示|可直接|免予|免于/;

const APPLICABILITY_ASSERTION = /本规范适用|适用于|视同适用|即适用/;

const LABELS = Object.freeze({
  governs: "**管什么**：",
  whenToRead: "**何时查阅**：",
});

const BARE_LABELS = Object.freeze({
  governs: "管什么：",
  whenToRead: "何时查阅：",
});

const POSITIONING_UNAVAILABLE = Object.freeze({
  NO_SECTION: "no-section",
  EXTRA_PARAGRAPHS: "extra-paragraphs",
  EMPTY_PARAGRAPH: "empty-paragraph",
  LABEL_MISSING_GOVERNS: "label-missing:管什么",
  LABEL_MISSING_WHEN: "label-missing:何时查阅",
  TOO_LONG_GOVERNS: "too-long:管什么",
  TOO_LONG_WHEN: "too-long:何时查阅",
  AUTHORIZATION_GOVERNS: "authorization-wording:管什么",
  AUTHORIZATION_WHEN: "authorization-wording:何时查阅",
  ASSERTION_WHEN: "applicability-assertion:何时查阅",
  MULTI_SENTENCE_GOVERNS: "multi-sentence:管什么",
  MULTI_SENTENCE_WHEN: "multi-sentence:何时查阅",
});

function stripMarkup(text) {
  return text.replace(/\*\*/g, "").replace(/`/g, "");
}

function parseLabeledParagraph(paragraph, key) {
  const folded = paragraph.replace(/\s+/g, " ").trim();
  const startsWithLabel = folded.startsWith(LABELS[key]);
  const flat = stripMarkup(folded);
  const bare = BARE_LABELS[key];
  if (!flat.startsWith(bare)) return { labelOk: startsWithLabel, text: "", multiSentence: false };
  const rest = flat.slice(bare.length).trim();
  const sentence = /^(.+?[。；])/.exec(rest);
  const leftover = sentence ? rest.slice(sentence[1].length).trim() : "";
  return {
    labelOk: startsWithLabel,
    text: (sentence ? sentence[1] : rest).trim(),
    multiSentence: leftover !== "",
  };
}

export function normPositioningOf(raw) {
  const unavailable = (reason) => ({
    available: false,
    governs: "",
    whenToRead: "",
    unavailable_reason: reason,
  });
  if (typeof raw !== "string" || raw.trim() === "") return unavailable(POSITIONING_UNAVAILABLE.NO_SECTION);

  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const section = sectionContent(body, POSITIONING_SECTION_TITLE);
  if (section === null || section.trim() === "") return unavailable(POSITIONING_UNAVAILABLE.NO_SECTION);

  const paragraphs = section.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "");
  if (paragraphs.length !== 2) return unavailable(POSITIONING_UNAVAILABLE.EXTRA_PARAGRAPHS);

  const first = parseLabeledParagraph(paragraphs[0], "governs");
  const second = parseLabeledParagraph(paragraphs[1], "whenToRead");
  if (!first.labelOk) return unavailable(POSITIONING_UNAVAILABLE.LABEL_MISSING_GOVERNS);
  if (!second.labelOk) return unavailable(POSITIONING_UNAVAILABLE.LABEL_MISSING_WHEN);
  if (first.text === "") return unavailable(POSITIONING_UNAVAILABLE.EMPTY_PARAGRAPH);
  if (second.text === "") return unavailable(POSITIONING_UNAVAILABLE.EMPTY_PARAGRAPH);
  if (first.multiSentence) return unavailable(POSITIONING_UNAVAILABLE.MULTI_SENTENCE_GOVERNS);
  if (second.multiSentence) return unavailable(POSITIONING_UNAVAILABLE.MULTI_SENTENCE_WHEN);

  if (first.text.length > POSITIONING_MAX_CHARS) return unavailable(POSITIONING_UNAVAILABLE.TOO_LONG_GOVERNS);
  if (second.text.length > POSITIONING_MAX_CHARS) return unavailable(POSITIONING_UNAVAILABLE.TOO_LONG_WHEN);

  if (AUTHORIZATION_WORDING.test(first.text)) return unavailable(POSITIONING_UNAVAILABLE.AUTHORIZATION_GOVERNS);
  if (AUTHORIZATION_WORDING.test(second.text)) return unavailable(POSITIONING_UNAVAILABLE.AUTHORIZATION_WHEN);
  if (APPLICABILITY_ASSERTION.test(second.text)) return unavailable(POSITIONING_UNAVAILABLE.ASSERTION_WHEN);

  return { available: true, governs: first.text, whenToRead: second.text, unavailable_reason: null };
}

export function positioningExcerptLine(positioning) {
  const governs = typeof positioning?.governs === "string" ? positioning.governs.trim() : "";
  const whenToRead = typeof positioning?.whenToRead === "string" ? positioning.whenToRead.trim() : "";
  if (governs === "" || whenToRead === "") return "";
  return `${POSITIONING_EXCERPT_PREFIX}${governs}${POSITIONING_EXCERPT_SEPARATOR}${whenToRead}`;
}

export const POSITIONING_EXCERPT_PREFIX = "  ↳ 管什么：";
export const POSITIONING_EXCERPT_SEPARATOR = " ｜ 何时查阅：";
