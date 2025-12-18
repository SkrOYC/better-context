import fs from 'node:fs/promises';
import path from 'node:path';
import { ConfigError } from '../errors.ts';

export const expandHome = (filePath: string): string => {
  if (filePath.startsWith('~/')) {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return path.join(homeDir, filePath.slice(2));
  }
  return filePath;
};

export const directoryExists = async (dir: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw new ConfigError('Failed to check directory', error);
  }
};

export const ensureDirectory = async (dir: string): Promise<void> => {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    throw new ConfigError('Failed to create directory', error);
  }
};