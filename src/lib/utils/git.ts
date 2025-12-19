import { ConfigError } from '../errors';
import fs from 'node:fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { logger } from './logger.ts';

// Git operation timeout - 30 seconds should be sufficient for most networks
const GIT_TIMEOUT_MS = 30000;

// Set git config with default author information to prevent MissingNameError
const setGitConfig = async (repoDir: string) => {
	await git.setConfig({
		fs,
		dir: repoDir,
		path: 'user.name',
		value: 'btca'
	});
	await git.setConfig({
		fs,
		dir: repoDir,
		path: 'user.email',
		value: 'btca@localhost'
	});
};

export const cloneRepo = async (args: {
	repoDir: string;
	url: string;
	branch: string;
 }): Promise<void> => {
	try {
		const { repoDir, url, branch } = args;
		const cloneOptions: any = {
		fs,
		http,
		dir: repoDir,
		url,
		ref: branch,
		depth: 1,
		singleBranch: true,
		// Suppress all progress output to keep CLI clean
		onProgress: undefined,
		onMessage: undefined,
		// Add timeout to prevent hanging
		timeout: {
			block: true
		}
	};

	await git.clone(cloneOptions);
		// Set git config after cloning to avoid author issues during future pull operations
		await setGitConfig(repoDir);
	} catch (error) {
		throw new ConfigError('Failed to clone repo', error);
	}
};

export const pullRepo = async (args: { repoDir: string; branch: string }): Promise<void> => {
	try {
		const { repoDir, branch } = args;
		// Set git config before pulling to avoid author issues
		await setGitConfig(repoDir);
		
		const pullOptions = {
			fs,
			http,
			dir: repoDir,
			ref: branch,
			// Suppress all progress output to keep CLI clean
			onProgress: undefined,
			onMessage: undefined,
			// Add timeout to prevent hanging
			timeout: {
				block: true
			}
		};

		await git.pull(pullOptions);
		await logger.info(`Pull completed for ${repoDir}`);
	} catch (error) {
		throw new ConfigError('Failed to pull repo', error);
	}
};