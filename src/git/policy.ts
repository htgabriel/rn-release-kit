import type { ReleaseKitContext } from '../context.js'
import { requireSuccess, type RunResult } from '../exec/run.js'
import type { GitPolicy } from '../config/schema.js'

export function git(ctx: ReleaseKitContext, args: string[], { allowFail = false }: { allowFail?: boolean } = {}): RunResult {
	const result = ctx.run('git', args, { cwd: ctx.repoRoot, inherit: false })
	if (!allowFail) requireSuccess(result, `git ${args.join(' ')}`)
	return result
}

export function gitPorcelain(ctx: ReleaseKitContext): string {
	return git(ctx, ['status', '--porcelain']).stdout
}

export function isWorkingTreeClean(ctx: ReleaseKitContext, ignoreDirs: string[] = ['.release/']): boolean {
	const dirty = gitPorcelain(ctx)
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
		.filter((line) => !ignoreDirs.some((dir) => line.endsWith(` ${dir}`) || line.includes(` ${dir}`)))
	return dirty.length === 0
}

export function dirtyFiles(ctx: ReleaseKitContext, ignoreDirs: string[] = ['.release/']): string[] {
	return gitPorcelain(ctx)
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
		.filter((line) => !ignoreDirs.some((dir) => line.endsWith(` ${dir}`) || line.includes(` ${dir}`)))
}

export function currentBranch(ctx: ReleaseKitContext): string {
	return git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
}

export function headSha(ctx: ReleaseKitContext): string {
	return git(ctx, ['rev-parse', 'HEAD']).stdout.trim()
}

export function remoteSha(ctx: ReleaseKitContext, remote: string, branch: string): string | null {
	const result = git(ctx, ['rev-parse', `${remote}/${branch}`], { allowFail: true })
	if (result.status !== 0) return null
	return result.stdout.trim()
}

export function tagShaFormatted(ctx: ReleaseKitContext, tagFormat: string, version: string): string | null {
	const tag = renderTag(tagFormat, version)
	const result = git(ctx, ['rev-parse', `${tag}^{commit}`], { allowFail: true })
	if (result.status !== 0) return null
	return result.stdout.trim()
}

export function tagsPointingAtHead(ctx: ReleaseKitContext): string[] {
	const result = git(ctx, ['tag', '--points-at', 'HEAD'], { allowFail: true })
	return (result.stdout || '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
}

export function lastTagMatching(ctx: ReleaseKitContext, tagFormat: string): string | null {
	const pattern = tagGlob(tagFormat)
	const result = git(ctx, ['tag', '--list', pattern, '--sort=-creatordate'], { allowFail: true })
	const [first] = (result.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean)
	return first ?? null
}

export function aheadBehind(
	ctx: ReleaseKitContext,
	remote: string,
	branch: string
): { ahead: number; behind: number } | null {
	const upstream = git(ctx, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { allowFail: true })
	if (upstream.status !== 0) return null
	const counts = git(ctx, ['rev-list', '--left-right', '--count', `HEAD...${remote}/${branch}`], {
		allowFail: true,
	})
	if (counts.status !== 0) return null
	const [ahead = '0', behind = '0'] = counts.stdout.trim().split(/\s+/)
	return { ahead: Number(ahead), behind: Number(behind) }
}

export function renderTag(tagFormat: string, version: string): string {
	return tagFormat.replace('{version}', version)
}

/** Converte "v{version}" em um glob de `git tag --list` (ex: "v*"). */
function tagGlob(tagFormat: string): string {
	return tagFormat.replace('{version}', '*')
}

export interface GitCheckResult {
	name: string
	status: 'pass' | 'fail' | 'skip' | 'warn'
	message: string
}

/**
 * Assertivas de política de git usadas pelo doctor e pelo gate de build.
 * Reflete a regra do release kit original: production exige branch de
 * release, tag == HEAD, e HEAD == remoto.
 */
export function checkGitPolicy(
	ctx: ReleaseKitContext,
	policy: GitPolicy,
	{ version, isProtectedChannel }: { version: string; isProtectedChannel: boolean }
): GitCheckResult[] {
	const checks: GitCheckResult[] = []
	const branch = currentBranch(ctx)

	if (policy.requireClean) {
		const dirty = dirtyFiles(ctx)
		if (dirty.length) {
			checks.push({ name: 'git-clean', status: 'fail', message: `working tree suja:\n${dirty.join('\n')}` })
		} else {
			checks.push({ name: 'git-clean', status: 'pass', message: 'working tree limpa' })
		}
	}

	if (isProtectedChannel) {
		if (branch !== policy.releaseBranch) {
			checks.push({
				name: 'git-branch',
				status: 'fail',
				message: `canal protegido exige branch ${policy.releaseBranch} (atual: ${branch}).`,
			})
		} else {
			checks.push({ name: 'git-branch', status: 'pass', message: `branch ${branch}` })
		}

		const head = headSha(ctx)
		const expectedTag = renderTag(policy.tagFormat, version)
		const tagSha = tagShaFormatted(ctx, policy.tagFormat, version)
		if (!tagSha) {
			checks.push({ name: 'git-tag', status: 'fail', message: `tag ${expectedTag} não existe (versão atual: ${version}).` })
		} else if (tagSha !== head) {
			checks.push({
				name: 'git-tag',
				status: 'fail',
				message: `tag ${expectedTag} (${tagSha.slice(0, 8)}) não aponta para HEAD (${head.slice(0, 8)}).`,
			})
		} else {
			checks.push({ name: 'git-tag', status: 'pass', message: `${expectedTag} == HEAD` })
		}

		if (policy.requireSyncedWithRemote) {
			const remote = remoteSha(ctx, policy.remote, policy.releaseBranch)
			if (!remote) {
				checks.push({
					name: 'git-sync',
					status: 'fail',
					message: `${policy.remote}/${policy.releaseBranch} ausente. Rode git fetch ${policy.remote} ${policy.releaseBranch}.`,
				})
			} else if (remote !== head) {
				checks.push({
					name: 'git-sync',
					status: 'fail',
					message: `HEAD (${head.slice(0, 8)}) ≠ ${policy.remote}/${policy.releaseBranch} (${remote.slice(0, 8)}).`,
				})
			} else {
				checks.push({ name: 'git-sync', status: 'pass', message: `HEAD == ${policy.remote}/${policy.releaseBranch}` })
			}
		}
		return checks
	}

	if (policy.requireSyncedWithRemote) {
		const status = aheadBehind(ctx, policy.remote, branch)
		if (!status) {
			checks.push({ name: 'git-sync', status: 'fail', message: `branch ${branch} sem upstream. Rode git push -u.` })
		} else if (status.behind > 0) {
			checks.push({ name: 'git-sync', status: 'fail', message: `branch atrasada ${status.behind} commit(s) em relação ao upstream.` })
		} else if (status.ahead > 0) {
			checks.push({ name: 'git-sync', status: 'fail', message: `branch adiantada ${status.ahead} commit(s) — faça push antes de buildar.` })
		} else {
			checks.push({ name: 'git-sync', status: 'pass', message: 'sincronizada com o upstream' })
		}
	}

	return checks
}
