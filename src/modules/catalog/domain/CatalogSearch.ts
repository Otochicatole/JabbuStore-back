export interface CatalogSearchDocument {
  readonly words: readonly string[];
  readonly compactValues: readonly string[];
  readonly fuzzyWords: readonly (readonly string[])[];
}

interface CatalogSearchInput {
  fullName: string;
  weapon: string;
  name: string;
  exterior?: string | null;
  phase?: string | null;
}

interface SearchTerm {
  value: string;
  numeric: boolean;
  fuzzyCharacters: readonly string[] | null;
}

function normalize(value: string): string {
  return value
    // Compatibility decomposition would otherwise turn the trademark into "TM".
    .replace(/[™®©℠]/gu, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function fuzzyCharacters(value: string, minimumLength = 4): readonly string[] | null {
  if (!/^\p{L}+$/u.test(value)) return null;
  const characters = Array.from(value);
  return characters.length >= minimumLength ? characters : null;
}

/** Prepare search-only values without changing canonical names or item IDs. */
export function createCatalogSearchDocument(
  input: CatalogSearchInput,
): CatalogSearchDocument {
  const values = new Set<string>();
  for (const source of [
    input.fullName,
    input.weapon,
    input.name,
    input.exterior,
    input.phase,
  ]) {
    if (!source) continue;
    // Pipes and brackets separate fields in canonical names. In particular,
    // never compact a finish together with its parenthesized wear condition.
    for (const segment of source.split(/[|()[\]{}]+/u)) {
      const value = normalize(segment);
      if (value) values.add(value);
    }
  }

  const words = [...new Set([...values].flatMap((value) => value.split(" ")))];
  const compactValues = [...new Set([...values].map((value) => value.replace(/ /g, "")))];
  const fuzzyWords = [...new Set([...words, ...compactValues])].flatMap((value) => {
    // A four-letter query can contain one extra character in a three-letter word.
    const characters = fuzzyCharacters(value, 3);
    return characters ? [characters] : [];
  });

  return { words, compactValues, fuzzyWords };
}

/** Linear bounded edit check, including a single adjacent transposition. */
function withinOneEdit(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    let firstDifference = -1;
    let secondDifference = -1;
    for (let index = 0; index < left.length; index++) {
      if (left[index] === right[index]) continue;
      if (firstDifference < 0) firstDifference = index;
      else if (secondDifference < 0) secondDifference = index;
      else return false;
    }
    if (secondDifference < 0) return true;
    return (
      secondDifference === firstDifference + 1 &&
      left[firstDifference] === right[secondDifference] &&
      left[secondDifference] === right[firstDifference]
    );
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex++;
      longIndex++;
    } else {
      if (skipped) return false;
      skipped = true;
      longIndex++;
    }
  }
  return true;
}

export function createCatalogSearch(query?: string): {
  isEmpty: boolean;
  canUseFuzzy: boolean;
  matches(document: CatalogSearchDocument, fuzzy?: boolean): boolean;
} {
  const normalized = normalize(query ?? "");
  const terms: SearchTerm[] = normalized
    ? [...new Set(normalized.split(" "))].map((value) => ({
        value,
        numeric: /^\p{N}+$/u.test(value),
        fuzzyCharacters: fuzzyCharacters(value),
      }))
    : [];

  return {
    isEmpty: terms.length === 0,
    canUseFuzzy: terms.some((term) => term.fuzzyCharacters !== null),
    matches(document, fuzzy = false) {
      return terms.every((term) => {
        if (term.numeric) return document.words.includes(term.value);
        if (
          document.words.some((word) => word.includes(term.value)) ||
          document.compactValues.some((value) => value.includes(term.value))
        ) return true;

        const characters = term.fuzzyCharacters;
        return Boolean(
          fuzzy &&
          characters &&
          document.fuzzyWords.some((word) => withinOneEdit(characters, word)),
        );
      });
    },
  };
}
