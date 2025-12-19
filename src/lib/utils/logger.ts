import fs from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from './files.ts';

export type LogLevel = 'INFO' | 'ERROR' | 'WARN' | 'DEBUG' | 'LOG';

export class Logger {
	private logFilePath: string;

	private logDir: string;

	constructor() {
		this.logDir = expandHome('~/.config/btca');

		this.logFilePath = path.join(this.logDir, 'btca.log');
	}

	private formatLogEntry(level: LogLevel, message: string): string {
		const timestamp = new Date().toISOString();

		return `[${timestamp}] [${level}] ${message}\n`;
	}

	private async ensureLogDir(): Promise<void> {
		try {
			await fs.mkdir(this.logDir, { recursive: true });
		} catch (error) {
			console.error(`Failed to create log directory: ${error}`);
		}
	}

	async log(level: LogLevel, message: string): Promise<void> {
		try {
			await this.ensureLogDir();

			const logEntry = this.formatLogEntry(level, message);

			await fs.appendFile(this.logFilePath, logEntry);

			// Control console output

			if (level === 'ERROR') {
				console.error(message);
			} else if (level === 'LOG') {
				console.log(message);
			} else if (level === 'WARN') {
				console.log(`Warning: ${message}`);
			} else if (level === 'DEBUG' && process.env.BTCA_DEBUG) {
				console.error(`[DEBUG] ${message}`);
			}

			// INFO is now file-only
		} catch (error) {
			// Fail silently to avoid disrupting the main application

			if (process.env.BTCA_DEBUG) {
				console.error(`Failed to write to log file: ${error}`);
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
