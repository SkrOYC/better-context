import { Effect } from 'effect';
import { ConfigError } from '../errors';
import fs from 'node:fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

export const cloneRepo = (args: {
	repoDir: string;
	url: string;
	branch: string;
	quiet?: boolean;
}) =>
	Effect.tryPromise({
		try: async () => {
			const { repoDir, url, branch, quiet } = args;
			await git.clone({
				fs,
				http,
				dir: repoDir,
				url,
				ref: branch,
				depth: 1,
				singleBranch: true,
				onProgress: quiet ? undefined : (progress) => {
					console.log(`${progress.phase}: ${progress.loaded}/${progress.total}`);
				}
			});
		},
		catch: (error) => new ConfigError({ message: 'Failed to clone repo', cause: error })
	});

export const pullRepo = (args: { repoDir: string; branch: string; quiet?: boolean }) =>
	Effect.tryPromise({
		try: async () => {
			const { repoDir, branch, quiet } = args;
			await git.pull({
				fs,
				http,
				dir: repoDir,
				ref: branch,
				onProgress: quiet ? undefined : (progress) => {
					console.log(`${progress.phase}: ${progress.loaded}/${progress.total}`);
				}
			});
		},
		catch: (error) => new ConfigError({ message: 'Failed to pull repo', cause: error })
	});
