import type { ReleaseKitContext } from '../context.js'
import type { Platform, ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { fail } from '../exec/run.js'
import { checkGitPolicy } from '../git/policy.js'
import { readAppVersion } from '../project/version.js'
import {
	assertEasAuth,
	assertEasJsonExists,
	assertExpoDoctor,
	assertFingerprint,
	assertLockfileClean,
	assertRemoteVersion,
	assertSentry,
	assertShellClean,
	assertToolchain,
	type Check,
} from './checks.js'

export interface DoctorOptions {
	channel?: string
	platform?: Platform
	deep?: boolean
	buildId?: string
	allowToolchainDrift?: boolean
}

export interface DoctorReport {
	ok: boolean
	checks: Check[]
	toolchainDrift: boolean
}

export function runDoctor(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: DoctorOptions): DoctorReport {
	assertEasJsonExists(ctx)

	const channel = opts.channel ? channelOf(config, opts.channel) : null
	if (opts.platform && !config.platforms.includes(opts.platform)) {
		fail(`--platform ${opts.platform} não está em config.platforms (${config.platforms.join(', ')}).`)
	}

	const checks: Check[] = []
	const version = readAppVersion(ctx.appDir, config)

	checks.push(...checkGitPolicy(ctx, config.git, { version, isProtectedChannel: Boolean(channel?.protected) }))
	assertShellClean(ctx, checks)

	if (config.doctor.sentry) {
		assertSentry(ctx, checks, channel)
	} else {
		checks.push({ name: 'sentry', status: 'skip', message: 'desligado em doctor.sentry' })
	}

	assertEasAuth(ctx, checks, config.easOwner)
	const toolchain = assertToolchain(ctx, checks, config, {
		platform: opts.platform,
		allowToolchainDrift: opts.allowToolchainDrift,
	})
	assertLockfileClean(ctx, checks)

	if (channel && opts.platform) {
		assertRemoteVersion(ctx, checks, { platform: opts.platform, channel })
		assertFingerprint(ctx, checks, { channel, deep: opts.deep, buildId: opts.buildId })
	} else {
		checks.push({ name: 'remote-version', status: 'skip', message: 'passe --channel e --platform para consultar versionCode/buildNumber' })
		checks.push({ name: 'fingerprint', status: 'skip', message: 'passe --channel para avaliar runtimeVersion' })
	}

	assertExpoDoctor(ctx, checks, config)

	const failed = checks.filter((item) => item.status === 'fail')
	return {
		ok: failed.length === 0,
		checks,
		toolchainDrift: toolchain.toolchainDrift,
	}
}

export function printDoctorReport(report: DoctorReport, ctx: ReleaseKitContext): void {
	for (const item of report.checks) {
		const mark = item.status === 'pass' ? '✓' : item.status === 'skip' ? '·' : item.status === 'warn' ? '!' : '✗'
		ctx.log.info(`${mark} ${item.name}: ${item.message}`)
	}
}

export function requireDoctorPass(report: DoctorReport): void {
	if (report.ok) return
	const failed = report.checks.filter((item) => item.status === 'fail')
	const summary = failed.map((item) => `- ${item.name}: ${item.message}`).join('\n')
	fail(`doctor falhou:\n${summary}`)
}
