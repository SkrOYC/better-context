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
      // Use a promise to handle async operations in the interval
      Promise.resolve().then(() => this.cleanupStaleServers()).catch(console.error);
    }, 5 * 60 * 1000);
  }
  
  async createServer(key: string, options: { port: number }): Promise<{ client: OpencodeClient; server: { close: () => void; url: string } }> {
    // Close existing server for same key if needed
    await this.closeServer(key);
    
    const { client, server } = await createOpencode(options);
    // Extract the tech name from the key (assuming format is "tech-timestamp")
    const tech = key.substring(0, key.lastIndexOf('-'));
    this.activeServers.set(key, { 
      client, 
      server, 
      createdAt: Date.now(), 
      tech 
    });
    
    await logger.info(`Created server for ${key}, total active servers: ${this.activeServers.size}`);
    return { client, server };
  }
  
  async closeServer(key: string): Promise<void> {
    const entry = this.activeServers.get(key);
    if (entry) {
      try {
        entry.server.close();
        this.activeServers.delete(key);
        await logger.info(`Closed server for ${key}, remaining active servers: ${this.activeServers.size}`);
      } catch (error) {
        await logger.error(`Error closing server for ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
	private async cleanupStaleServers(): Promise<void> {
		const staleThreshold = 10 * 60 * 1000; // 10 minutes
		const now = Date.now();
		
		for (const [key, entry] of this.activeServers.entries()) {
			if (now - entry.createdAt > staleThreshold) {
				await logger.info(`Cleaning up stale server for ${key}`);
				await this.closeServer(key);
			}
		}
	}
  
  private async forceCloseAll(): Promise<void> {
    clearInterval(this.cleanupInterval);
    const serverCount = this.activeServers.size;
    if (serverCount > 0) {
      await logger.info(`Cleaning up ${serverCount} active servers...`);
      const keys = Array.from(this.activeServers.keys());
      await Promise.all(keys.map(key => this.closeServer(key)));
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