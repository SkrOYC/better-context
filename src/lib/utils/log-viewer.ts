import fs from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from './files.ts';
import { logger } from './logger.ts';

/**
 * Get the log directory path
 */
export function getLogDirectory(): string {
	return expandHome('~/.config/btca');
}

/**
 * Get the main log file path
 */
export function getLogFilePath(): string {
	return path.join(getLogDirectory(), 'btca.log');
}

/**
 * Get all available log files (including rotated ones)
 */
export async function getLogFiles(): Promise<string[]> {
	const logDir = getLogDirectory();
	
	try {
		const entries = await fs.readdir(logDir);
		return entries
			.filter(entry => entry.startsWith('btca.log'))
			.map(entry => path.join(logDir, entry))
			.sort(); // Sort to have main log first, then rotated logs
	} catch (error) {
		return [];
	}
}

/**
 * Read the last N lines from a log file
 */
export async function readLastLines(filePath: string, lineCount: number = 50): Promise<string[]> {
	try {
		const content = await fs.readFile(filePath, 'utf-8');
		const lines = content.split('\n').filter(line => line.trim());
		return lines.slice(-lineCount);
	} catch (error) {
		return [];
	}
}

/**
 * Get recent log entries from all log files
 */
export async function getRecentLogs(lineCount: number = 100): Promise<string[]> {
	const logFiles = await getLogFiles();
	const allLines: string[] = [];

	// Start with the main log file
	for (const logFile of logFiles) {
		const lines = await readLastLines(logFile, lineCount);
		allLines.push(...lines);
		
		// If we have enough lines, stop
		if (allLines.length >= lineCount) {
			break;
		}
	}

	// Return the last N lines from all logs combined
	return allLines.slice(-lineCount);
}

/**
 * Display recent logs to console
 */
export async function showRecentLogs(lineCount: number = 50): Promise<void> {
	const logs = await getRecentLogs(lineCount);
	
	if (logs.length === 0) {
		await logger.ui('No logs found.');
		return;
	}

	await logger.ui(`Showing last ${logs.length} log entries:`);
	await logger.ui('');
	
	for (const line of logs) {
		console.log(line);
	}
}

/**
 * Get log file statistics
 */
export async function getLogStats(): Promise<{
	totalFiles: number;
	totalSize: number;
	mainLogSize: number;
}> {
	const logFiles = await getLogFiles();
	let totalSize = 0;
	let mainLogSize = 0;

	for (const logFile of logFiles) {
		try {
			const stats = await fs.stat(logFile);
			totalSize += stats.size;
			
			if (logFile.endsWith('btca.log')) {
				mainLogSize = stats.size;
			}
		} catch (error) {
			// Ignore files that can't be read
		}
	}

	return {
		totalFiles: logFiles.length,
		totalSize,
		mainLogSize
	};
}
