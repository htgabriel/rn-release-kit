import type { ReleaseKitContext } from '../context.js'
import { fail, requireSuccess, type RunResult } from '../exec/run.js'
import type { Platform } from '../config/schema.js'

export function eas(
	ctx: ReleaseKitContext,
	args: string[],
	{ inherit = false, env = {}, cwd }: { inherit?: boolean; env?: Record<string, string>; cwd?: string } = {}
): RunResult {
	return ctx.run('eas', args, {
		cwd: cwd ?? ctx.appDir,
		env,
		inherit,
		dryRun: ctx.dryRun,
	})
}

export interface RemoteVersion {
	versionCode: string | null
	buildNumber: string | null
	raw: unknown
	dryRun?: boolean
}

export function parseRemoteVersion(stdout: string): RemoteVersion {
	const text = String(stdout || '').trim()
	const jsonStart = text.indexOf('{')
	if (jsonStart === -1) return { versionCode: null, buildNumber: null, raw: text }
	try {
		const parsed = JSON.parse(text.slice(jsonStart)) as { versionCode?: unknown; buildNumber?: unknown }
		return {
			versionCode: parsed.versionCode != null ? String(parsed.versionCode) : null,
			buildNumber: parsed.buildNumber != null ? String(parsed.buildNumber) : null,
			raw: parsed,
		}
	} catch {
		return { versionCode: null, buildNumber: null, raw: text }
	}
}

export function projectRemoteVersion(
	ctx: ReleaseKitContext,
	{ platform, buildProfile }: { platform: Platform | 'all'; buildProfile: string }
): RemoteVersion {
	const args = ['build:version:get', '--non-interactive', '--json', '-e', buildProfile, '-p', platform]
	const result = eas(ctx, args)
	if (ctx.dryRun) return { versionCode: null, buildNumber: null, raw: null, dryRun: true }
	requireSuccess(result, 'eas build:version:get')
	return parseRemoteVersion(result.stdout)
}

export interface BuildNumberProjection {
	key: 'buildNumber' | 'versionCode'
	current: string | null
	expected: string | null
}

export function expectedBuildNumber(
	current: RemoteVersion,
	{ autoIncrement, platform }: { autoIncrement: boolean; platform: Platform }
): BuildNumberProjection {
	const key: BuildNumberProjection['key'] = platform === 'ios' ? 'buildNumber' : 'versionCode'
	const currentValue = current[key]
	if (!currentValue) return { key, current: null, expected: null }
	if (!autoIncrement) return { key, current: currentValue, expected: currentValue }
	const numeric = Number(currentValue)
	if (!Number.isFinite(numeric)) return { key, current: currentValue, expected: null }
	return { key, current: currentValue, expected: String(numeric + 1) }
}

export function easWhoami(ctx: ReleaseKitContext): { ok: boolean; account: string | null; raw: string } {
	const result = eas(ctx, ['whoami'])
	if (ctx.dryRun) return { ok: true, account: null, raw: '[dry-run]' }
	if (result.status !== 0) return { ok: false, account: null, raw: result.stderr || result.stdout }
	const account = result.stdout.trim().split('\n').pop() ?? null
	return { ok: true, account, raw: result.stdout }
}

export function easEnvList(ctx: ReleaseKitContext, environment: string): RunResult {
	return eas(ctx, ['env:list', environment, '--format', 'short'])
}

export function easEnvListHasKey(ctx: ReleaseKitContext, environment: string, key: string): boolean {
	const result = easEnvList(ctx, environment)
	if (ctx.dryRun) return true
	if (result.status !== 0) return false
	const pattern = new RegExp(`(^|\\n)${key}(\\n|$)`)
	return pattern.test(`${result.stdout}\n${result.stderr}`)
}

export function easFingerprintGenerate(ctx: ReleaseKitContext, environment: string): RunResult {
	return eas(ctx, ['fingerprint:generate', '--non-interactive', '--json', '--environment', environment])
}

export function easFingerprintCompare(ctx: ReleaseKitContext, environment: string, buildId: string): RunResult {
	return eas(ctx, [
		'fingerprint:compare',
		'--non-interactive',
		'--json',
		'--build-id',
		buildId,
		'--environment',
		environment,
	])
}

export function easInit(ctx: ReleaseKitContext): RunResult {
	return eas(ctx, ['init', '--non-interactive'])
}

export interface EasBuildArgs {
	platform: Platform
	buildProfile: string
	local: boolean
	output?: string
	env: Record<string, string>
}

export function easBuild(ctx: ReleaseKitContext, opts: EasBuildArgs): RunResult {
	const args = ['build', '-p', opts.platform, '--profile', opts.buildProfile, '--non-interactive']
	if (opts.local) args.push('--local')
	if (opts.output) args.push('--output', opts.output)
	return eas(ctx, args, { inherit: true, env: opts.env })
}

export interface EasSubmitArgs {
	platform: Platform
	submitProfile: string
	path: string
	env: Record<string, string>
}

export function easSubmit(ctx: ReleaseKitContext, opts: EasSubmitArgs): RunResult {
	const args = ['submit', '-p', opts.platform, '--profile', opts.submitProfile, '--path', opts.path, '--non-interactive']
	return eas(ctx, args, { inherit: true, env: opts.env })
}

export interface EasUpdateArgs {
	channel: string
	message?: string
	platform?: Platform | 'all'
	env: Record<string, string>
}

export function easUpdate(ctx: ReleaseKitContext, opts: EasUpdateArgs): RunResult {
	const args = ['update', '--channel', opts.channel, '--non-interactive']
	if (opts.message) args.push('--message', opts.message)
	if (opts.platform) args.push('--platform', opts.platform)
	return eas(ctx, args, { inherit: true, env: opts.env })
}

export function assertEasCliAvailable(ctx: ReleaseKitContext): void {
	const result = ctx.run('eas', ['--version'], { cwd: ctx.appDir })
	if (result.status !== 0) {
		fail('eas-cli não encontrado no PATH. Instale com `npm install -g eas-cli` e rode `eas login`.')
	}
}
