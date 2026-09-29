import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import crossSpawn from 'cross-spawn'
import { createContext, type ReleaseKitContext } from '../../src/context.js'
import { createLogger } from '../../src/ui/log.js'

export interface TmpRepo {
	dir: string
	ctx: ReleaseKitContext
	git: (args: string[]) => string
	cleanup: () => void
}

/** Repo git real e temporário, pra testar git/policy.ts sem mockar spawn. */
export function createTmpRepo(): TmpRepo {
	const dir = mkdtempSync(join(tmpdir(), 'release-kit-test-'))
	const run = (args: string[]) => {
		const result = crossSpawn.sync('git', args, { cwd: dir, encoding: 'utf8' })
		if (result.status !== 0) throw new Error(`git ${args.join(' ')} falhou: ${result.stderr}`)
		return result.stdout
	}
	run(['init', '-q', '-b', 'main'])
	run(['config', 'user.email', 'test@example.com'])
	run(['config', 'user.name', 'Test'])
	writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { version: '1.0.0' } }, null, 2))
	run(['add', '.'])
	run(['commit', '-q', '-m', 'chore: initial'])

	const ctx = createContext({
		repoRoot: dir,
		appDir: dir,
		releaseDir: join(dir, '.release'),
		env: { ...process.env },
		log: createLogger({ json: true }),
	})

	return { dir, ctx, git: run, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
