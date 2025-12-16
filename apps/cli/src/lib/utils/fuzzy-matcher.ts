/**
 * Calculate the Levenshtein distance between two strings
 * This is a measure of the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one word into the other
 */
const levenshteinDistance = (str1: string, str2: string): number => {
  const matrix = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // insertion
        matrix[j - 1][i] + 1, // deletion
        matrix[j - 1][i - 1] + cost // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
};

/**
 * Find similar strings to the input from the given options
 * @param input The string to match against
 * @param options Array of possible matching strings
 * @param threshold Maximum distance allowed (lower = more similar). Default is 2
 * @param limit Maximum number of suggestions to return. Default is 3
 * @returns Array of similar strings sorted by similarity
 */
export const findSimilarStrings = (
  input: string,
  options: string[],
  threshold: number = 2,
  limit: number = 3
): string[] => {
  if (!input || !options || options.length === 0) {
    return [];
  }

  // Convert input to lowercase for case-insensitive matching
  const lowerInput = input.toLowerCase();
  
  // Calculate distances and filter by threshold
  const similarities = options
    .map(option => ({
      option,
      distance: levenshteinDistance(lowerInput, option.toLowerCase())
    }))
    .filter(item => item.distance <= threshold)
    .sort((a, b) => a.distance - b.distance); // Sort by distance (most similar first)

  // Return up to the limit of similar options
  return similarities.slice(0, limit).map(item => item.option);
};