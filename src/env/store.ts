import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import dotenv from 'dotenv'

export const ENV_FILENAME = '.env.release'

export function envPath(repoRoot: string): string {
	return join(repoRoot, ENV_FILENAME)
}

export function readEnvFile(repoRoot: string): Record<string, string> {
	const path = envPath(repoRoot)
	if (!existsSync(path)) return {}
	return dotenv.parse(readFileSync(path, 'utf8'))
}

/** Faz merge com o que já existe no arquivo — nunca apaga chaves não tocadas. */
export function writeEnvFile(repoRoot: string, updates: Record<string, string | undefined>): string {
	const current = readEnvFile(repoRoot)
	const merged: Record<string, string> = { ...current }
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) continue
		merged[key] = value
	}
	const body = Object.entries(merged)
		.map(([key, value]) => `${key}=${escapeEnvValue(value)}`)
		.join('\n')
	const path = envPath(repoRoot)
	writeFileSync(path, `${body}\n`)
	try {
		chmodSync(path, 0o600)
	} catch {
		// best-effort — algumas plataformas (Windows/FAT) não suportam chmod
	}
	return path
}

function escapeEnvValue(value: string): string {
	if (/[\s#"'$]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`
	return value
}

/** Diretório fora do repo onde ficam os arquivos de credencial (.p8, .json da SA). */
export function credentialsDir(slug: string): string {
	return join(homedir(), '.release-kit', slug)
}

/**
 * Copia um arquivo de credencial para fora do repositório, com permissão
 * 600. Retorna o path final — é o que vai para o .env.release.
 */
export function storeCredentialFile(slug: string, sourcePath: string, filename?: string): string {
	const dir = credentialsDir(slug)
	mkdirSync(dir, { recursive: true, mode: 0o700 })
	const destName = filename ?? basename(sourcePath)
	const dest = join(dir, destName)
	copyFileSync(sourcePath, dest)
	try {
		chmodSync(dest, 0o600)
	} catch {
		// best-effort fora do macOS/Linux
	}
	return dest
}

export interface MaterializedSecret {
	path: string
	cleanup: () => void
}

/**
 * Em CI a credencial vem como conteúdo em uma env var (*_CONTENT), não como
 * arquivo no disco. Grava um arquivo temporário com permissão 600 e devolve
 * uma função de cleanup para apagar depois de usar.
 */
export function materializeSecretContent(content: string, filename: string): MaterializedSecret {
	const dir = mkdtempSync(join(tmpdir(), 'release-kit-'))
	const path = join(dir, filename)
	writeFileSync(path, content)
	try {
		chmodSync(path, 0o600)
	} catch {
		// best-effort
	}
	return {
		path,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	}
}

/**
 * Resolve uma credencial de arquivo a partir de duas env vars possíveis:
 * `<KEY>_PATH` (path direto) ou `<KEY>_CONTENT` (conteúdo, materializado em
 * um temp file — uso típico em CI/secrets). Se nenhuma existir, retorna null.
 */
export function resolveFileCredential(
	env: NodeJS.ProcessEnv,
	pathKey: string,
	contentKey: string,
	filename: string
): { path: string; cleanup: () => void } | null {
	const directPath = env[pathKey]
	if (directPath) return { path: directPath, cleanup: () => {} }
	const content = env[contentKey]
	if (content) return materializeSecretContent(content, filename)
	return null
}
