import TAGS_JSON from "../data/tags.json";

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Normalize and split into single-word vs phrase tags
const ALL_TAGS = (TAGS_JSON || [])
  .map(s => (s || "").toString().trim().toLowerCase())
  .filter(Boolean);

const SINGLE_WORD_TAGS = ALL_TAGS.filter(t => !t.includes(" "));
const PHRASE_TAGS = ALL_TAGS.filter(t => t.includes(" "));

// Fast membership for single words
const singleWordSet = new Set(SINGLE_WORD_TAGS);

// Precompile phrase regex (word boundaries) if any
const phraseRegex = PHRASE_TAGS.length
  ? new RegExp(`\\b(${PHRASE_TAGS.map(escapeRegex).join("|")})\\b`, "i")
  : null;

// Tokenize keeping hashtags/cashtags, then strip leading #/$ for comparison
const tokenize = (text) => {
  const t = (text || "").toLowerCase();
  const matches = t.match(/[#$]?[\p{L}\p{N}_]+/gu) || [];
  return matches.map(tok => tok.replace(/^[#$]/, ""));
};

export const matchTag = (text) => {
  const norm = (text || "").toLowerCase();

  // 1) Single-word exact token hits (handles #bitcoin, $btc → bitcoin/btc)
  for (const tok of tokenize(norm)) {
    if (singleWordSet.has(tok)) return tok;
  }

  // 2) Phrase hits with regex word boundaries
  if (phraseRegex) {
    const m = norm.match(phraseRegex);
    if (m && m[1]) return m[1].toLowerCase();
  }

  return null;
};

export { ALL_TAGS };
