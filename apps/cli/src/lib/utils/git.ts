import { ConfigError } from '../errors';
import fs from 'node:fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

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
	quiet?: boolean;
}): Promise<void> => {
	try {
		const { repoDir, url, branch, quiet } = args;
		await git.clone({
			fs,
			http,
			dir: repoDir,
			url,
			ref: branch,
			depth: 1,
			singleBranch: true,
			// Suppress all progress output to keep CLI clean
			onProgress: undefined,
			onMessage: undefined
		});
		// Set git config after cloning to avoid author issues during future pull operations
		await setGitConfig(repoDir);
	} catch (error) {
		throw new ConfigError({ message: 'Failed to clone repo', cause: error });
	}
};

export const pullRepo = async (args: { repoDir: string; branch: string; quiet?: boolean }): Promise<void> => {
	try {
		const { repoDir, branch, quiet } = args;
		// Set git config before pulling to avoid author issues
		await setGitConfig(repoDir);
		await git.pull({
			fs,
			http,
			dir: repoDir,
			ref: branch,
			// Suppress all progress output to keep CLI clean
			onProgress: undefined,
			onMessage: undefined
		});
	} catch (error) {
		throw new ConfigError({ message: 'Failed to pull repo', cause: error });
	}
};