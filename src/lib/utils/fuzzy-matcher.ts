/**
 * Calculate the Levenshtein distance between two strings
 * This is a measure of the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one word into the other
 */
const levenshteinDistance = (str1: string, str2: string): number => {
	if (str1 === str2) return 0;
	if (str1.length === 0) return str2.length;
	if (str2.length === 0) return str1.length;

	const matrix: number[][] = [];
	for (let j = 0; j <= str2.length; j++) {
		matrix[j] = [];
		for (let i = 0; i <= str1.length; i++) {
			if (j === 0) {
				matrix[j]![i] = i;
			} else if (i === 0) {
				matrix[j]![i] = j;
			} else {
				const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
				matrix[j]![i] = Math.min(
					matrix[j]![i - 1]! + 1,
					matrix[j - 1]![i]! + 1,
					matrix[j - 1]![i - 1]! + cost
				);
			}
		}
	}

	return matrix[str2.length]![str1.length]!;
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
		.map((option) => ({
			option,
			distance: levenshteinDistance(lowerInput, option.toLowerCase())
		}))
		.filter((item) => item.distance <= threshold)
		.sort((a, b) => a.distance - b.distance); // Sort by distance (most similar first)

	// Return up to the limit of similar options
	return similarities.slice(0, limit).map((item) => item.option);
};
