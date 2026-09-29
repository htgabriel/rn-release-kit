import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { fail } from '../exec/run.js'
import { parseConfig, type ReleaseKitConfig } from './schema.js'

export const CONFIG_FILENAME = 'release-kit.config.json'

export function configPath(repoRoot: string): string {
	return join(repoRoot, CONFIG_FILENAME)
}

export function configExists(repoRoot: string): boolean {
	return existsSync(configPath(repoRoot))
}

export function loadConfig(repoRoot: string): ReleaseKitConfig {
	const path = configPath(repoRoot)
	if (!existsSync(path)) {
		fail(
			`${CONFIG_FILENAME} não encontrado em ${repoRoot}. Rode \`release-kit init\` para criar a configuração.`
		)
	}
	let raw: unknown
	try {
		raw = JSON.parse(readFileSync(path, 'utf8'))
	} catch (error) {
		fail(`${CONFIG_FILENAME} não é um JSON válido: ${(error as Error).message}`)
	}
	try {
		return parseConfig(raw)
	} catch (error) {
		if (error instanceof z.ZodError) {
			const issues = error.issues.map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
			fail(`${CONFIG_FILENAME} inválido:\n${issues.join('\n')}`)
		}
		throw error
	}
}

export function writeConfig(repoRoot: string, config: ReleaseKitConfig): string {
	const path = configPath(repoRoot)
	const withSchema = { $schema: './node_modules/@htgabriel/release-kit/schema.json', ...config }
	writeFileSync(path, `${JSON.stringify(withSchema, null, 2)}\n`)
	return path
}
