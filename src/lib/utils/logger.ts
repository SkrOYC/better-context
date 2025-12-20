import fs from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from './files.ts';

export type LogLevel = 'INFO' | 'ERROR' | 'WARN' | 'DEBUG' | 'LOG';

export class Logger {
	private logFilePath: string;
	private logDir: string;
	private maxLogFiles = 5;
	private maxLogSize = 10 * 1024 * 1024; // 10MB
	private timers: Map<string, number> = new Map();

	constructor() {
		this.logDir = expandHome('~/.config/btca');
		this.logFilePath = path.join(this.logDir, 'btca.log');
	}

	/**
	 * Start a timer for the given operation
	 */
	startTimer(operation: string): void {
		this.timers.set(operation, Date.now());
	}

	/**
	 * End a timer and log the duration
	 */
	async endTimer(operation: string): Promise<void> {
		const startTime = this.timers.get(operation);
		if (startTime) {
			const duration = Date.now() - startTime;
			await this.info(`${operation} completed in ${duration}ms`);
			this.timers.delete(operation);
		}
	}

	/**
	 * End a timer and log the duration with a custom message
	 */
	async endTimerWithMessage(operation: string, message: string): Promise<void> {
		const startTime = this.timers.get(operation);
		if (startTime) {
			const duration = Date.now() - startTime;
			await this.info(`${message} (${duration}ms)`);
			this.timers.delete(operation);
		}
	}

	private formatLogEntry(level: LogLevel, message: string): string {
		const timestamp = new Date().toISOString();
		return `[${timestamp}] [${level}] ${message}\n`;
	}

	private formatConsoleMessage(level: LogLevel, message: string): string {
		const timestamp = new Date().toLocaleTimeString('en-US', { 
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		return `[${timestamp}] ${message}`;
	}

	private async rotateLogs(): Promise<void> {
		try {
			// Check if current log file exceeds max size
			const stats = await fs.stat(this.logFilePath).catch(() => null);
			if (!stats || stats.size < this.maxLogSize) {
				return;
			}

			// Remove oldest log file if we have too many
			const oldestLog = path.join(this.logDir, `btca.log.${this.maxLogFiles}`);
			await fs.unlink(oldestLog).catch(() => {}); // Ignore if file doesn't exist

			// Rotate existing log files
			for (let i = this.maxLogFiles - 1; i >= 1; i--) {
				const currentLog = path.join(this.logDir, `btca.log.${i}`);
				const nextLog = path.join(this.logDir, `btca.log.${i + 1}`);
				await fs.rename(currentLog, nextLog).catch(() => {});
			}

			// Move current log to .1
			const firstRotated = path.join(this.logDir, 'btca.log.1');
			await fs.rename(this.logFilePath, firstRotated);
		} catch (error) {
			// Don't let log rotation failures break the app
			console.error(`Log rotation failed: ${error}`);
		}
	}

	private async ensureLogDir(): Promise<void> {
		try {
			await fs.mkdir(this.logDir, { recursive: true });
		} catch (error) {
			console.error(`Failed to create log directory: ${error}`);
		}
	}

	async log(level: LogLevel, message: string): Promise<void> {
		let fileWriteSuccess = false;
		
		try {
			await this.ensureLogDir();
			await this.rotateLogs();

			const logEntry = this.formatLogEntry(level, message);
			await fs.appendFile(this.logFilePath, logEntry);
			fileWriteSuccess = true;

			// Control console output with timestamps
			const consoleMessage = this.formatConsoleMessage(level, message);

			if (level === 'ERROR') {
				console.error(consoleMessage);
			} else if (level === 'LOG') {
				console.log(consoleMessage);
			} else if (level === 'WARN') {
				console.log(`Warning: ${consoleMessage}`);
			} else if (level === 'DEBUG' && process.env.BTCA_DEBUG) {
				console.error(`[DEBUG] ${consoleMessage}`);
			} else if (level === 'INFO' && process.env.BTCA_DEBUG) {
				// Show INFO logs in console when debug mode is enabled
				console.log(`[INFO] ${consoleMessage}`);
			}
		} catch (error) {
			// Always show logging errors to console, not just in debug mode
			const errorMsg = `Failed to write to log file: ${error}`;
			console.error(`[LOGGER ERROR] ${errorMsg}`);
			
			// Still try to show the original message to console
			const consoleMessage = this.formatConsoleMessage(level, message);
			if (level === 'ERROR') {
				console.error(consoleMessage);
			} else if (level === 'LOG' || level === 'WARN') {
				console.log(consoleMessage);
			}
		}
	}

	/**



     * Write to both log file and stdout WITHOUT a trailing newline.



     * Useful for streaming output.



     */

	async write(message: string): Promise<void> {
		try {
			// For the log file, we still want newlines or some separator to keep it readable,

			// but for simplicity we'll just write it as is.

			// Actually, it's better to just write the raw stream to stdout and maybe

			// not log every single chunk to the file to avoid massive log files.

			// But let's stay consistent.

			await this.ensureLogDir();

			await fs.appendFile(this.logFilePath, message);

			process.stdout.write(message);
		} catch (error) {
			if (process.env.BTCA_DEBUG) {
				console.error(`Failed to write to log: ${error}`);
			}
		}
	}

	/**



     * Log for internal tracing, file only.



     */

	async info(message: string): Promise<void> {
		await this.log('INFO', message);
	}

	/**

   * Intentional command output for the user.

   */

	async ui(message: string): Promise<void> {
		await this.log('LOG', message);
	}

	async error(message: string): Promise<void> {
		await this.log('ERROR', message);
	}

	async warn(message: string): Promise<void> {
		await this.log('WARN', message);
	}

	async debug(message: string): Promise<void> {
		await this.log('DEBUG', message);
	}
}

// Create a singleton instance for the application
export const logger = new Logger();
