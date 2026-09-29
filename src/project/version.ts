import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import { fail } from '../exec/run.js'
import type { ReleaseKitConfig } from '../config/schema.js'

interface VersionFile {
	path: string
	json: Record<string, unknown>
	get(): string
	set(next: string): void
}

function loadVersionFile(appDir: string, source: 'app.json' | 'package.json'): VersionFile {
	const path = join(appDir, source)
	if (!existsSync(path)) fail(`${source} não encontrado em ${appDir}.`)
	const raw = readFileSync(path, 'utf8')
	const json = JSON.parse(raw) as Record<string, unknown>

	if (source === 'app.json') {
		return {
			path,
			json,
			get: () => {
				const expo = json.expo as Record<string, unknown> | undefined
				const version = expo?.version
				if (typeof version !== 'string') fail(`app.json não tem expo.version.`)
				return version
			},
			set: (next) => {
				const expo = (json.expo as Record<string, unknown>) ?? {}
				expo.version = next
				json.expo = expo
			},
		}
	}

	return {
		path,
		json,
		get: () => {
			const version = json.version
			if (typeof version !== 'string') fail(`package.json não tem "version".`)
			return version
		},
		set: (next) => {
			json.version = next
		},
	}
}

export function readAppVersion(appDir: string, config: ReleaseKitConfig): string {
	return loadVersionFile(appDir, config.version.source).get()
}

export type VersionBump = 'patch' | 'minor' | 'major' | string

export function nextVersion(current: string, bump: VersionBump): string {
	if (bump === 'patch' || bump === 'minor' || bump === 'major') {
		const next = semver.inc(current, bump)
		if (!next) fail(`não foi possível incrementar "${bump}" a partir de ${current}.`)
		return next
	}
	if (!semver.valid(bump)) fail(`versão inválida: "${bump}". Use patch | minor | major | x.y.z.`)
	if (semver.lte(bump, current)) {
		fail(`${bump} não é maior que a versão atual (${current}).`)
	}
	return bump
}

/**
 * Grava a nova versão preservando o resto do arquivo. Retorna o path
 * escrito, para o caller decidir o `git add`/commit.
 */
export function writeAppVersion(appDir: string, config: ReleaseKitConfig, next: string): string {
	const file = loadVersionFile(appDir, config.version.source)
	file.set(next)
	writeFileSync(file.path, `${JSON.stringify(file.json, null, '\t')}\n`)
	return file.path
}
