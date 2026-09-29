import type { ReleaseKitContext } from '../context.js'

export interface ToolchainInfo {
	easCli: string | null
	node: string | null
	yarn: string | null
	jdk: string | null
	xcode: string | null
	xcodeBuild: string | null
	cocoapods: string | null
	ndkHome: string | null
	host: string
}

/**
 * cmpVersion próprio (não `semver`) porque versões de toolchain como Java
 * "17", NDK "27.1.12297006" ou Xcode "26.6" não são semver válido.
 */
export function parseVersion(input: string | null | undefined): { major: number; minor: number; patch: number } | null {
	const match = String(input ?? '')
		.replace(/^v/i, '')
		.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
	if (!match) return null
	return { major: Number(match[1]), minor: Number(match[2] || 0), patch: Number(match[3] || 0) }
}

export function cmpVersion(a: string, b: string): number {
	const pa = parseVersion(a)
	const pb = parseVersion(b)
	if (!pa || !pb) return 0
	if (pa.major !== pb.major) return pa.major - pb.major
	if (pa.minor !== pb.minor) return pa.minor - pb.minor
	return pa.patch - pb.patch
}

export function collectToolchain(ctx: ReleaseKitContext): ToolchainInfo {
	const capture = (command: string, args: string[], pick: (text: string) => string | null): string | null => {
		const result = ctx.run(command, args, { inherit: false })
		if (result.status !== 0) return null
		return pick(`${result.stdout}\n${result.stderr}`)
	}
	const firstMatch = (text: string, re: RegExp): string | null => text.match(re)?.[1] ?? null

	return {
		easCli: capture('eas', ['--version'], (t) => firstMatch(t, /eas-cli\/(\d+\.\d+\.\d+)/)),
		node: capture('node', ['-v'], (t) => firstMatch(t, /v?(\d+\.\d+\.\d+)/)),
		yarn: capture('yarn', ['-v'], (t) => firstMatch(t, /(\d+\.\d+\.\d+)/)),
		jdk: capture('java', ['-version'], (t) => firstMatch(t, /version "(\d+(?:\.\d+\.\d+)?)/)),
		xcode: capture('xcodebuild', ['-version'], (t) => firstMatch(t, /Xcode (\d+\.\d+)/)),
		xcodeBuild: capture('xcodebuild', ['-version'], (t) => firstMatch(t, /Build version (\S+)/)),
		cocoapods: capture('pod', ['--version'], (t) => firstMatch(t, /(\d+\.\d+\.\d+)/)),
		ndkHome: ctx.env.ANDROID_NDK_HOME || null,
		host: `${process.platform}-${process.arch}`,
	}
}
