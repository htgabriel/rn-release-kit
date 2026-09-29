import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReleaseKitContext } from '../context.js'
import { fail, formatCommand, requireSuccess } from '../exec/run.js'
import type { Platform, ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { easSubmit } from '../eas/cli.js'
import { assertChannelOptIn, type ProtectedGateOptions } from './gate.js'
import { findLatestMetadata, type ReleaseMetadata } from './metadata.js'

export interface SubmitOptions extends ProtectedGateOptions {
	channel: string
	platform?: Platform
	/** true = usa o metadata.json mais recente gerado por `build`. */
	latest?: boolean
	/** artefato avulso (.aab/.ipa), sem passar por `build`. */
	path?: string
}

export interface SubmitResult {
	dryRun?: boolean
	command?: string
	submitProfile: string
	artifactPath: string
}

export function inferPlatformFromArtifact(artifactPath: string): Platform {
	const lower = artifactPath.toLowerCase()
	if (lower.endsWith('.apk')) {
		fail('Submit Android exige AAB. O profile de sideload não vai à loja; gere o binário com um profile de release/production.')
	}
	if (lower.endsWith('.aab')) return 'android'
	if (lower.endsWith('.ipa')) return 'ios'
	fail('submit --path exige um arquivo .aab ou .ipa.')
}

export function submitRelease(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: SubmitOptions): SubmitResult {
	const channel = channelOf(config, opts.channel)
	assertChannelOptIn(ctx, config, channel, opts)
	if (!channel.store) {
		fail(`canal "${opts.channel}" não envia à loja (store: false).`)
	}
	const submitProfile = channel.submitProfile ?? channel.buildProfile

	let artifactPath: string
	let platform: Platform

	if (opts.path) {
		artifactPath = resolve(ctx.repoRoot, opts.path)
		if (!existsSync(artifactPath)) fail(`Artefato não encontrado: ${artifactPath}.`)
		platform = inferPlatformFromArtifact(artifactPath)
		if (opts.platform && opts.platform !== platform) {
			fail(`--platform ${opts.platform} não corresponde ao arquivo (${platform}).`)
		}
	} else {
		const entry = findLatestMetadata(ctx.releaseDir, { channel: opts.channel, platform: opts.platform })
		const metadata = entry.metadata as ReleaseMetadata
		artifactPath = metadata.artifactPath
		platform = metadata.platform
		if (!artifactPath || !existsSync(artifactPath)) {
			fail(`Artefato não encontrado: ${artifactPath || '(ausente no metadata)'}. Builds na nuvem não têm artefato local — use --path após baixar.`)
		}
	}

	if (platform === 'android' && !artifactPath.toLowerCase().endsWith('.aab')) {
		fail('Submit Android exige AAB.')
	}

	if (ctx.dryRun) {
		const command = formatCommand('eas', ['submit', '-p', platform, '--profile', submitProfile, '--path', artifactPath], channel.env)
		ctx.log.info(`[dry-run] cd ${ctx.appDir} && ${command}`)
		return { dryRun: true, command, submitProfile, artifactPath }
	}

	ctx.log.step(`eas submit --path (${platform}/${submitProfile})`)
	requireSuccess(easSubmit(ctx, { platform, submitProfile, path: artifactPath, env: channel.env }), 'eas submit')
	return { submitProfile, artifactPath }
}
