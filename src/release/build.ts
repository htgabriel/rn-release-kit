import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ReleaseKitContext } from '../context.js'
import { fail, formatCommand, requireSuccess } from '../exec/run.js'
import type { Platform, ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { readAppVersion } from '../project/version.js'
import { readEasJson } from '../project/detect.js'
import { androidBuildTypeExt } from '../eas/profiles.js'
import { easBuild, projectRemoteVersion } from '../eas/cli.js'
import { assertChannelOptIn, type ProtectedGateOptions } from './gate.js'
import { gitInfo, sha256File, writeMetadata, type ReleaseMetadata } from './metadata.js'
import { collectToolchain } from '../doctor/toolchain.js'

export interface BuildOptions extends ProtectedGateOptions {
	channel: string
	platform: Platform
	cloud?: boolean
	output?: string
	toolchainDrift?: boolean
}

export interface BuildResult {
	dryRun?: boolean
	command?: string
	artifactPath?: string
	metadata?: ReleaseMetadata
	staging?: string
}

export function artifactExt(ctx: ReleaseKitContext, platform: Platform, buildProfile: string): 'ipa' | 'apk' | 'aab' {
	if (platform === 'ios') return 'ipa'
	const easJson = readEasJson(ctx.appDir)
	if (!easJson) fail(`eas.json não encontrado em ${ctx.appDir}.`)
	return androidBuildTypeExt(easJson, buildProfile)
}

export function buildRelease(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: BuildOptions): BuildResult {
	const channel = channelOf(config, opts.channel)
	assertChannelOptIn(ctx, config, channel, opts)

	if (!config.platforms.includes(opts.platform)) {
		fail(`--platform ${opts.platform} não está em config.platforms.`)
	}

	const ext = artifactExt(ctx, opts.platform, channel.buildProfile)
	const staging = opts.output
		? resolve(ctx.repoRoot, opts.output)
		: join(ctx.releaseDir, `_building-${opts.platform}-${opts.channel}.${ext}`)

	const local = !opts.cloud
	if (ctx.dryRun) {
		const env = channel.env
		const command = formatCommand('eas', ['build', '-p', opts.platform, '--profile', channel.buildProfile, ...(local ? ['--local'] : []), '--output', staging], env)
		ctx.log.info(`[dry-run] cd ${ctx.appDir} && ${command}`)
		return { dryRun: true, command, staging }
	}

	mkdirSync(dirname(staging), { recursive: true })
	ctx.log.step(`eas build ${local ? '--local' : '(cloud)'} (${opts.platform}/${opts.channel})`)
	requireSuccess(
		easBuild(ctx, { platform: opts.platform, buildProfile: channel.buildProfile, local, output: local ? staging : undefined, env: channel.env }),
		'eas build'
	)

	if (local && !existsSync(staging)) fail(`Build concluiu sem artefato em ${staging}.`)

	const remote = projectRemoteVersion(ctx, { platform: opts.platform, buildProfile: channel.buildProfile })
	const version = readAppVersion(ctx.appDir, config)
	const versionCode = remote.versionCode
	const buildNumber = opts.platform === 'ios' ? remote.buildNumber : remote.versionCode
	const git = gitInfo(ctx)
	const dirName = `${opts.platform}-${opts.channel}-${version}-${buildNumber || 'unknown'}`
	const finalDir = join(ctx.releaseDir, dirName)
	mkdirSync(finalDir, { recursive: true })
	const finalPath = local ? join(finalDir, `app.${ext}`) : ''

	if (local && resolve(staging) !== resolve(finalPath)) {
		copyFileSync(staging, finalPath)
		if (staging.includes('_building-')) {
			try {
				unlinkSync(staging)
			} catch {
				// leftover em .release/ é gitignored
			}
		}
	}

	const metadata = writeMetadata(finalDir, {
		platform: opts.platform,
		channel: opts.channel,
		buildProfile: channel.buildProfile,
		version,
		buildNumber,
		versionCode,
		artifactPath: finalPath,
		sha256: local && existsSync(finalPath) ? sha256File(finalPath) : '',
		commitSha: git.sha,
		branch: git.branch,
		tag: git.tag,
		createdAt: new Date().toISOString(),
		toolchain: collectToolchain(ctx),
		toolchainDrift: Boolean(opts.toolchainDrift),
	})

	if (local) {
		ctx.log.success(`artefato ${finalPath}`)
	} else {
		ctx.log.success('build enviado ao EAS Build Cloud — use `eas build:list` para acompanhar e baixar o artefato.')
	}
	ctx.log.success(`metadata ${join(finalDir, 'metadata.json')}`)
	return { artifactPath: finalPath, metadata }
}
