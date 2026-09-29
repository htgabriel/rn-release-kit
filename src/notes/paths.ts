import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../exec/run.js'
import type { NotesTarget } from './limits.js'

export function notesDirFor(appDir: string, notesDir: string, version: string): string {
	return join(appDir, notesDir, version)
}

export function notesFilePath(appDir: string, notesDir: string, version: string, locale: string, target: NotesTarget): string {
	return join(notesDirFor(appDir, notesDir, version), `${locale}.${target}.txt`)
}

export function readNotesFile(path: string): string {
	if (!existsSync(path)) fail(`Notas não encontradas: ${path}. Rode \`release-kit notes\` primeiro.`)
	const text = readFileSync(path, 'utf8').trim()
	if (!text) fail(`Notas vazias em ${path}.`)
	return text
}

export function writeNotesFile(path: string, text: string): void {
	mkdirSync(join(path, '..'), { recursive: true })
	writeFileSync(path, `${text.trim()}\n`)
}
