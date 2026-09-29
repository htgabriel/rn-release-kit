import { relative } from 'node:path'
import type { ReleaseKitContext } from '../context.js'
import type { ReleaseKitConfig } from '../config/schema.js'
import { fail, requireSuccess } from '../exec/run.js'
import { git, isWorkingTreeClean, renderTag } from '../git/policy.js'
import { nextVersion, readAppVersion, writeAppVersion, type VersionBump } from '../project/version.js'

export interface BumpVersionOptions {
	bump: VersionBump
	push?: boolean
}

export interface BumpVersionResult {
	from: string
	to: string
	tag: string
	dryRun?: boolean
}

export function bumpVersion(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: BumpVersionOptions): BumpVersionResult {
	if (!isWorkingTreeClean(ctx)) {
		fail('working tree suja. Commit ou descarte as mudanças antes de rodar `release-kit version`.')
	}
	const current = readAppVersion(ctx.appDir, config)
	const next = nextVersion(current, opts.bump)
	const tag = renderTag(config.git.tagFormat, next)

	if (ctx.dryRun) {
		ctx.log.info(`[dry-run] ${current} → ${next} (tag ${tag})`)
		return { from: current, to: next, tag, dryRun: true }
	}

	const path = writeAppVersion(ctx.appDir, config, next)
	const relPath = relative(ctx.repoRoot, path)
	git(ctx, ['add', relPath])
	git(ctx, ['commit', '-m', `chore(release): ${tag}`])
	git(ctx, ['tag', tag])
	ctx.log.success(`${current} → ${next} (commit + tag ${tag})`)

	if (opts.push) {
		requireSuccess(git(ctx, ['push', config.git.remote, config.git.releaseBranch]), 'git push')
		requireSuccess(git(ctx, ['push', config.git.remote, tag]), 'git push tag')
		ctx.log.success(`push ${config.git.remote} ${config.git.releaseBranch} + tag ${tag}`)
	}

	return { from: current, to: next, tag }
}
