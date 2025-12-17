import fs from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from './files.ts';

export type LogLevel = 'INFO' | 'ERROR' | 'WARN' | 'DEBUG';

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
    } catch (error) {
      // Fail silently to avoid disrupting the main application
      // Only log to console if it's a critical error during logging
      if (process.env.BTCA_DEBUG) {
        console.error(`Failed to write to log file: ${error}`);
      }
    }
  }

  async info(message: string): Promise<void> {
    await this.log('INFO', message);
  }

  async error(message: string): Promise<void> {
    await this.log('ERROR', message);
  }

  async warn(message: string): Promise<void> {
    await this.log('WARN', message);
  }

  async debug(message: string): Promise<void> {
    // Only log debug messages if BTCA_DEBUG environment variable is set
    if (process.env.BTCA_DEBUG) {
      await this.log('DEBUG', message);
    }
  }

  async resource(message: string): Promise<void> {
    await this.log('INFO', `[RESOURCE] ${message}`);
  }

  async metrics(message: string): Promise<void> {
    await this.log('INFO', `[METRICS] ${message}`);
  }

  async tool(message: string, metadata?: object): Promise<void> {
    let logMessage = `[TOOL] ${message}`;
    if (metadata) {
      logMessage += `\n${JSON.stringify(metadata, null, 2)}`;
    }
    await this.log('INFO', logMessage);
  }
}

// Create a singleton instance for the application
export const logger = new Logger();