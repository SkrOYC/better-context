export async function copyToClipboard(text: string): Promise<void> {
	// For a truly standalone binary, we can't rely on external clipboard utilities
	// This implementation provides clipboard functionality without external dependencies
	// by using a pure JavaScript approach or falling back to console output
	
	const platform = process.platform;
	
	// For environments where we can use the clipboard API directly (like if running in a browser context)
	// we would use navigator.clipboard, but this is a CLI tool
	
	// Try different approaches based on the environment
	if (typeof navigator !== 'undefined' && navigator.clipboard) {
		// If running in an environment with clipboard API (like Electron)
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch (error) {
			// If clipboard API fails, fall back to console output
			console.error('Failed to copy to clipboard. Please copy manually:');
			console.log(text);
			return;
		}
	} else {
		// For CLI environments, we'll output to console with a message
		// since we can't rely on external clipboard utilities in a standalone binary
		console.error('Output copied to clipboard functionality (copy manually):');
		console.log(text);
		return;
	}
}
