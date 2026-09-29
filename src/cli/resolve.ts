import { resolve } from 'node:path'
import crossSpawn from 'cross-spawn'
import { createContext, type ReleaseKitContext } from '../context.js'
import { loadConfig } from '../config/load.js'
import type { ReleaseKitConfig } from '../config/schema.js'
import { createLogger } from '../ui/log.js'

export function findRepoRoot(cwd: string = process.cwd()): string {
	const result = crossSpawn.sync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
	if (result.status === 0 && result.stdout) return result.stdout.trim()
	return cwd
}

export interface GlobalFlags {
	dryRun?: boolean
	json?: boolean
	verbose?: boolean
	nonInteractive?: boolean
}

export function buildContext(flags: GlobalFlags = {}): ReleaseKitContext {
	const repoRoot = findRepoRoot()
	const json = Boolean(flags.json)
	return createContext({
		repoRoot,
		dryRun: Boolean(flags.dryRun),
		json,
		verbose: Boolean(flags.verbose),
		nonInteractive: flags.nonInteractive ?? !process.stdin.isTTY,
		log: createLogger({ json, verbose: flags.verbose }),
	})
}

export function withAppDir(ctx: ReleaseKitContext, config: ReleaseKitConfig): ReleaseKitContext {
	return { ...ctx, appDir: resolve(ctx.repoRoot, config.appDir), releaseDir: resolve(ctx.repoRoot, config.appDir, '.release') }
}

export function loadContextAndConfig(flags: GlobalFlags = {}): { ctx: ReleaseKitContext; config: ReleaseKitConfig } {
	const base = buildContext(flags)
	const config = loadConfig(base.repoRoot)
	return { ctx: withAppDir(base, config), config }
}
