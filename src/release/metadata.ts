import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReleaseKitContext } from '../context.js'
import { fail } from '../exec/run.js'
import { git } from '../git/policy.js'
import type { Platform } from '../config/schema.js'
import type { ToolchainInfo } from '../doctor/toolchain.js'

export interface ReleaseMetadata {
	platform: Platform
	channel: string
	buildProfile: string
	version: string
	buildNumber: string | null
	versionCode: string | null
	artifactPath: string
	sha256: string
	commitSha: string
	branch: string
	tag: string
	createdAt: string
	toolchain: ToolchainInfo | null
	toolchainDrift: boolean
}

export function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export interface GitInfo {
	sha: string
	branch: string
	tag: string
}

export function gitInfo(ctx: ReleaseKitContext): GitInfo {
	const sha = git(ctx, ['rev-parse', 'HEAD']).stdout.trim()
	const branch = git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
	const tagResult = git(ctx, ['tag', '--points-at', 'HEAD'], { allowFail: true })
	const tag =
		(tagResult.stdout || '')
			.split('\n')
			.map((line) => line.trim())
			.find((line) => /^v\d/.test(line)) || ''
	return { sha, branch, tag }
}

export function writeMetadata(dir: string, payload: Omit<ReleaseMetadata, never>): ReleaseMetadata {
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, 'metadata.json'), `${JSON.stringify(payload, null, 2)}\n`)
	return payload
}

export interface MetadataEntry {
	dir: string
	metaPath: string
	metadata: ReleaseMetadata
	createdAt: string
}

export function findLatestMetadata(releaseDir: string, { channel, platform }: { channel?: string; platform?: Platform } = {}): MetadataEntry {
	if (!existsSync(releaseDir)) fail(`Nenhum artefato em ${releaseDir}. Rode \`release-kit build\` primeiro.`)
	const entries = readdirSync(releaseDir)
		.map((name): MetadataEntry | null => {
			const dir = join(releaseDir, name)
			const metaPath = join(dir, 'metadata.json')
			if (!statSync(dir).isDirectory() || !existsSync(metaPath)) return null
			const metadata = JSON.parse(readFileSync(metaPath, 'utf8')) as ReleaseMetadata
			if (platform && metadata.platform !== platform) return null
			if (channel && metadata.channel !== channel) return null
			return { dir, metaPath, metadata, createdAt: metadata.createdAt || '' }
		})
		.filter((entry): entry is MetadataEntry => entry !== null)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
	const [first] = entries
	if (!first) {
		fail(`Nenhum metadata.json${platform ? ` para ${platform}` : ''}${channel ? ` (canal ${channel})` : ''} em ${releaseDir}.`)
	}
	return first
}
