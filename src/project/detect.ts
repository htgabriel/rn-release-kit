import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type PackageManager = 'yarn' | 'npm' | 'pnpm'

const LOCKFILES: Record<PackageManager, string> = {
	yarn: 'yarn.lock',
	pnpm: 'pnpm-lock.yaml',
	npm: 'package-lock.json',
}

/** Detecta o package manager pelo lockfile presente na raiz do repo. */
export function detectPackageManager(repoRoot: string): PackageManager {
	for (const [pm, lockfile] of Object.entries(LOCKFILES) as [PackageManager, string][]) {
		if (existsSync(join(repoRoot, lockfile))) return pm
	}
	return 'npm'
}

/**
 * Detecta o diretório do app Expo: primeiro tenta a raiz do repo, depois
 * `apps/*` e `packages/*` (padrão de monorepo) em busca de um app.json com
 * `expo`.
 */
export function detectAppDir(repoRoot: string): string | null {
	if (hasExpoAppJson(repoRoot)) return '.'
	const candidateDirs = ['apps', 'packages']
	for (const dir of candidateDirs) {
		const base = join(repoRoot, dir)
		if (!existsSync(base)) continue
		const entries = safeReadDir(base)
		for (const entry of entries) {
			const candidate = join(dir, entry)
			if (hasExpoAppJson(join(repoRoot, candidate))) return candidate
		}
	}
	return null
}

function hasExpoAppJson(dir: string): boolean {
	const path = join(dir, 'app.json')
	if (!existsSync(path)) return false
	try {
		const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
		return typeof json.expo === 'object' && json.expo !== null
	} catch {
		return false
	}
}

function safeReadDir(dir: string): string[] {
	try {
		return readdirSync(dir)
	} catch {
		return []
	}
}

export function detectEasJson(appDir: string): boolean {
	return existsSync(join(appDir, 'eas.json'))
}

export function readEasJson(appDir: string): Record<string, unknown> | null {
	const path = join(appDir, 'eas.json')
	if (!existsSync(path)) return null
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
	} catch {
		return null
	}
}
