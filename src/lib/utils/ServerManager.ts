import { createOpencode, type OpencodeClient } from '@opencode-ai/sdk';
import { logger } from './logger.ts';

export interface ServerInstance {
  client: OpencodeClient;
  server: { close: () => void; url: string };
  createdAt: number;
  tech: string;
}

export class ServerManager {
  private activeServers = new Map<string, ServerInstance>();
  private cleanupInterval: NodeJS.Timeout;
  
  constructor() {
    // Auto-cleanup stale servers every 5 minutes
    this.cleanupInterval = setInterval(() => {
      // Use a promise to handle async logging in the interval
      Promise.resolve().then(() => this.cleanupStaleServers()).catch(console.error);
    }, 5 * 60 * 1000);
    
    // Register process exit handlers
    process.on('exit', () => { 
      // Use a promise to handle async operations in exit handler
      Promise.resolve().then(() => this.forceCloseAll()).catch(console.error);
    });
    process.on('SIGINT', () => { 
      // Use a promise to handle async operations in signal handler
      Promise.resolve().then(() => this.forceCloseAll()).catch(console.error);
      process.exit(0); 
    });
    process.on('SIGTERM', () => { 
      // Use a promise to handle async operations in signal handler
      Promise.resolve().then(() => this.forceCloseAll()).catch(console.error);
      process.exit(0); 
    });
  }
  
  async createServer(key: string, options: any): Promise<{ client: OpencodeClient; server: any }> {
    // Close existing server for same key if needed
    await this.closeServer(key);
    
    const { client, server } = await createOpencode(options);
    this.activeServers.set(key, { 
      client, 
      server, 
      createdAt: Date.now(), 
      tech: key 
    });
    
    await logger.info(`Created server for ${key}, total active servers: ${this.activeServers.size}`);
    return { client, server };
  }
  
  async closeServer(key: string): Promise<void> {
    const entry = this.activeServers.get(key);
    if (entry) {
      try {
        await entry.server.close();
        this.activeServers.delete(key);
        await logger.info(`Closed server for ${key}, remaining active servers: ${this.activeServers.size}`);
      } catch (error) {
        await logger.error(`Error closing server for ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
  private cleanupStaleServers(): void {
    const staleThreshold = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    
    for (const [key, entry] of this.activeServers.entries()) {
      if (now - entry.createdAt > staleThreshold) {
        logger.info(`Cleaning up stale server for ${key}`).catch(console.error);
        this.closeServer(key).catch(console.error);
      }
    }
  }
  
  private async forceCloseAll(): Promise<void> {
    clearInterval(this.cleanupInterval);
    const serverCount = this.activeServers.size;
    if (serverCount > 0) {
      await logger.info(`Cleaning up ${serverCount} active servers...`);
      const keys = Array.from(this.activeServers.keys());
      for (const key of keys) {
        await this.closeServer(key);
      }
      await logger.info('Server cleanup completed');
    }
  }
  
  getActiveServerCount(): number {
    return this.activeServers.size;
  }
  
  async closeAll(): Promise<void> {
    await this.forceCloseAll();
  }
}