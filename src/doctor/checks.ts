import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ReleaseKitContext } from '../context.js'
import type { ChannelConfig, Platform, ReleaseKitConfig } from '../config/schema.js'
import { checkGitPolicy, type GitCheckResult } from '../git/policy.js'
import { readAppVersion } from '../project/version.js'
import { detectPackageManager } from '../project/detect.js'
import {
	easEnvListHasKey,
	easFingerprintCompare,
	easFingerprintGenerate,
	easWhoami,
	expectedBuildNumber,
	projectRemoteVersion,
} from '../eas/cli.js'
import { collectToolchain, cmpVersion, type ToolchainInfo } from './toolchain.js'

export type CheckStatus = 'pass' | 'fail' | 'skip' | 'warn'
export interface Check {
	name: string
	status: CheckStatus
	message: string
}

const EXPO_PUBLIC_PREFIX = 'EXPO_PUBLIC_'

function check(name: string, status: CheckStatus, message: string): Check {
	return { name, status, message }
}

export function assertShellClean(ctx: ReleaseKitContext, checks: Check[]): void {
	const leaked = Object.keys(ctx.env).filter((key) => key.startsWith(EXPO_PUBLIC_PREFIX) && ctx.env[key])
	if (leaked.length) {
		checks.push(
			check(
				'shell-env',
				'fail',
				`shell tem ${leaked.join(', ')} exportado. Em build local isso vence as env vars do EAS. Unset antes de continuar.`
			)
		)
		return
	}
	checks.push(check('shell-env', 'pass', 'nenhum EXPO_PUBLIC_* no shell'))
}

export function assertSentry(ctx: ReleaseKitContext, checks: Check[], channel: ChannelConfig | null): void {
	if (channel?.sentryUploadDisabled) {
		checks.push(check('sentry', 'pass', 'canal desliga o upload de sourcemap; token não é exigido.'))
		return
	}
	const inShell = Boolean(ctx.env.SENTRY_AUTH_TOKEN)
	if (!channel && !inShell) {
		checks.push(check('sentry', 'skip', 'passe --channel para verificar SENTRY_AUTH_TOKEN no environment EAS.'))
		return
	}
	if (inShell) {
		checks.push(
			check(
				'sentry',
				'warn',
				'SENTRY_AUTH_TOKEN está no shell e, em build local, vence o token do EAS. Prefira unset e deixe o environment EAS (Sensitive) injetar.'
			)
		)
		return
	}
	const environment = channel?.easEnvironment
	if (environment && easEnvListHasKey(ctx, environment, 'SENTRY_AUTH_TOKEN')) {
		checks.push(check('sentry', 'pass', `SENTRY_AUTH_TOKEN no environment EAS ${environment}.`))
		return
	}
	checks.push(
		check(
			'sentry',
			'fail',
			`SENTRY_AUTH_TOKEN ausente no shell e no environment EAS ${environment || '(defina easEnvironment no canal)'}.`
		)
	)
}

export function assertEasAuth(ctx: ReleaseKitContext, checks: Check[], easOwner?: string): void {
	const result = easWhoami(ctx)
	if (ctx.dryRun) {
		checks.push(check('eas-auth', 'pass', '[dry-run] eas whoami'))
		return
	}
	if (!result.ok) {
		checks.push(check('eas-auth', 'fail', `eas whoami falhou. Rode \`eas login\` ou defina EXPO_TOKEN.\n${result.raw}`))
		return
	}
	if (easOwner && !result.raw.includes(easOwner)) {
		checks.push(check('eas-auth', 'fail', `eas whoami não listou a conta ${easOwner}.`))
		return
	}
	checks.push(check('eas-auth', 'pass', `autenticado${result.account ? ` como ${result.account}` : ''}`))
}

export interface ToolchainCheckResult {
	actual: ToolchainInfo
	drift: string[]
	toolchainDrift: boolean
}

export function assertToolchain(
	ctx: ReleaseKitContext,
	checks: Check[],
	config: ReleaseKitConfig,
	{ platform, allowToolchainDrift }: { platform?: Platform; allowToolchainDrift?: boolean }
): ToolchainCheckResult {
	const baseline = config.toolchain
	const actual = collectToolchain(ctx)
	const drift: string[] = []

	const compare = (
		name: string,
		spec: { min?: string; tested?: string } | undefined,
		value: string | null,
		{ platformOnly }: { platformOnly?: Platform } = {}
	) => {
		if (!spec) {
			checks.push(check(`toolchain-${name}`, 'skip', 'sem baseline configurado'))
			return
		}
		if (platformOnly && platform && platform !== platformOnly) {
			checks.push(check(`toolchain-${name}`, 'skip', `não exigido para --platform ${platform}`))
			return
		}
		if (!value) {
			checks.push(check(`toolchain-${name}`, 'fail', `${name} não encontrado no PATH.`))
			return
		}
		if (spec.min && cmpVersion(value, spec.min) < 0) {
			checks.push(check(`toolchain-${name}`, 'fail', `${name} ${value} < mínimo ${spec.min}.`))
			return
		}
		if (spec.tested && cmpVersion(value, spec.tested) > 0) {
			drift.push(`${name} ${value} > testado ${spec.tested}`)
			checks.push(
				check(
					`toolchain-${name}`,
					allowToolchainDrift ? 'warn' : 'fail',
					`${name} ${value} está acima do testado (${spec.tested}). Passe --allow-toolchain-drift para continuar.`
				)
			)
			return
		}
		checks.push(check(`toolchain-${name}`, 'pass', `${name} ${value}`))
	}

	compare('eas-cli', baseline.easCli, actual.easCli)
	compare('node', baseline.node, actual.node)
	compare('jdk', baseline.jdk, actual.jdk, { platformOnly: 'android' })
	compare('xcode', baseline.xcode, actual.xcode, { platformOnly: 'ios' })
	compare('cocoapods', baseline.cocoapods, actual.cocoapods, { platformOnly: 'ios' })

	if (!platform || platform === 'android') {
		if (!ctx.env.JAVA_HOME) {
			checks.push(check('java-home', 'fail', 'JAVA_HOME não está definido.'))
		} else {
			checks.push(check('java-home', 'pass', ctx.env.JAVA_HOME))
		}
		if (!ctx.env.ANDROID_HOME && !ctx.env.ANDROID_SDK_ROOT) {
			checks.push(check('android-sdk', 'fail', 'ANDROID_HOME / ANDROID_SDK_ROOT ausente.'))
		} else {
			checks.push(check('android-sdk', 'pass', ctx.env.ANDROID_HOME || ctx.env.ANDROID_SDK_ROOT || ''))
		}
	}

	if (platform === 'ios' && process.platform !== 'darwin') {
		checks.push(check('platform-ios', 'fail', 'build local de iOS só funciona no macOS. Use --cloud ou remova --platform ios.'))
	} else if (platform === 'android' && process.platform === 'win32') {
		checks.push(
			check(
				'platform-android',
				'warn',
				'build local de Android no Windows não é suportado pelo EAS fora do WSL2. Use --cloud ou rode dentro do WSL2.'
			)
		)
	}

	return { actual, drift, toolchainDrift: drift.length > 0 }
}

export function assertLockfileClean(ctx: ReleaseKitContext, checks: Check[]): void {
	const pm = detectPackageManager(ctx.repoRoot)
	const lockfile = { yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml', npm: 'package-lock.json' }[pm]
	const diff = ctx.run('git', ['diff', '--quiet', 'HEAD', '--', lockfile], { cwd: ctx.repoRoot, inherit: false })
	if (diff.status !== 0) {
		checks.push(check('lockfile', 'fail', `${lockfile} diverge do HEAD. Commit ou restaure antes do build (lockfile congelado).`))
		return
	}
	checks.push(check('lockfile', 'pass', `${lockfile} igual ao HEAD`))
}

export function assertRemoteVersion(
	ctx: ReleaseKitContext,
	checks: Check[],
	{ platform, channel }: { platform: Platform; channel: ChannelConfig }
): void {
	const remote = projectRemoteVersion(ctx, { platform, buildProfile: channel.buildProfile })
	if (remote.dryRun) {
		checks.push(check('remote-version', 'pass', '[dry-run] eas build:version:get'))
		return
	}
	const projection = expectedBuildNumber(remote, { autoIncrement: channel.autoIncrement, platform })
	if (!channel.autoIncrement) {
		checks.push(
			check(
				'remote-version',
				'pass',
				`${projection.key} remoto atual: ${projection.current} (autoIncrement desligado; este build reutiliza o número).`
			)
		)
		return
	}
	checks.push(
		check(
			'remote-version',
			'pass',
			`${projection.key} remoto atual: ${projection.current} → esperado neste build: ${projection.expected} (só é reservado quando o EAS iniciar o build).`
		)
	)
}

export function assertFingerprint(
	ctx: ReleaseKitContext,
	checks: Check[],
	{ channel, deep, buildId }: { channel: ChannelConfig; deep?: boolean; buildId?: string }
): void {
	const environment = channel.easEnvironment
	if (!environment) {
		checks.push(check('fingerprint', 'skip', 'canal sem easEnvironment configurado.'))
		return
	}
	if (!deep) {
		checks.push(check('fingerprint', 'pass', `comparação contra build da nuvem só em --deep (environment ${environment}).`))
		return
	}
	if (ctx.dryRun) {
		checks.push(check('fingerprint', 'pass', `[dry-run] eas fingerprint:generate --environment ${environment}`))
		return
	}
	const generated = easFingerprintGenerate(ctx, environment)
	if (generated.status !== 0) {
		checks.push(check('fingerprint', 'fail', `eas fingerprint:generate falhou.\n${generated.stderr || generated.stdout}`))
		return
	}
	if (!buildId) {
		checks.push(
			check(
				'fingerprint',
				'pass',
				`fingerprint local gerado. Para comparar com a nuvem: eas fingerprint:compare --build-id <id> --environment ${environment}`
			)
		)
		return
	}
	const compared = easFingerprintCompare(ctx, environment, buildId)
	if (compared.status !== 0) {
		checks.push(check('fingerprint', 'fail', `eas fingerprint:compare falhou.\n${compared.stderr || compared.stdout}`))
		return
	}
	checks.push(check('fingerprint', 'pass', `fingerprint local vs build ${buildId}`))
}

export function assertExpoDoctor(ctx: ReleaseKitContext, checks: Check[], config: ReleaseKitConfig): void {
	if (!config.doctor.expoDoctor) {
		checks.push(check('expo-doctor', 'skip', 'desligado em doctor.expoDoctor'))
		return
	}
	if (ctx.dryRun) {
		checks.push(check('expo-doctor', 'pass', '[dry-run] npx expo-doctor'))
		return
	}
	const result = ctx.run('npx', ['expo-doctor'], { cwd: ctx.appDir, inherit: false })
	if (result.status !== 0) {
		const detail = (result.stdout || result.stderr || '').trim()
		checks.push(
			check('expo-doctor', 'fail', `expo-doctor saiu com código ${result.status}. Atualize as dependências com \`npx expo install\`.${detail ? `\n${detail}` : ''}`)
		)
		return
	}
	checks.push(check('expo-doctor', 'pass', 'expo-doctor ok'))
}

export function assertEasJsonExists(ctx: ReleaseKitContext): void {
	if (!existsSync(join(ctx.appDir, 'eas.json'))) {
		throw new Error(`eas.json não encontrado em ${ctx.appDir}. Rode \`eas init\` ou \`release-kit init\`.`)
	}
}

export { checkGitPolicy, type GitCheckResult }
export { readAppVersion }
