import { existsSync } from 'node:fs'
import type { ReleaseKitContext } from '../context.js'
import type { ReleaseKitConfig } from '../config/schema.js'
import { readAppVersion } from '../project/version.js'
import { commitsSinceLastTag } from '../git/commits.js'
import { draftNotes } from '../notes/draft.js'
import { openInEditor } from '../notes/editor.js'
import { assertNotesWithinLimit, type NotesTarget } from '../notes/limits.js'
import { notesFilePath, readNotesFile, writeNotesFile } from '../notes/paths.js'

export interface NotesOptions {
	version?: string
	/** Reabre no editor mesmo se o arquivo já existir. */
	edit?: boolean
	skipEditor?: boolean
}

export interface NotesResult {
	version: string
	files: Array<{ path: string; target: NotesTarget; locale: string }>
}

function targetsFor(config: ReleaseKitConfig): NotesTarget[] {
	const targets: NotesTarget[] = []
	if (config.platforms.includes('ios')) targets.push('ios')
	if (config.platforms.includes('android')) targets.push('play')
	return targets
}

/**
 * Gera (se faltar) e abre para edição as notas de cada locale/loja. Não
 * publica nada — só prepara os arquivos que `promote`/`review`/`notes`
 * (comando de loja) vão ler depois.
 */
export function draftAndEditNotes(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: NotesOptions): NotesResult {
	const version = opts.version ?? readAppVersion(ctx.appDir, config)
	const commits = commitsSinceLastTag(ctx, config.git.tagFormat)
	const targets = targetsFor(config)
	const files: NotesResult['files'] = []

	for (const locale of config.locales) {
		for (const target of targets) {
			const path = notesFilePath(ctx.appDir, config.notesDir, version, locale, target)
			const isNew = !existsSync(path)
			if (isNew) {
				writeNotesFile(path, draftNotes(commits, version))
				ctx.log.step(`rascunho criado: ${path}`)
			}
			if (!opts.skipEditor && (isNew || opts.edit)) {
				openInEditor(ctx, path)
			}
			const text = readNotesFile(path)
			assertNotesWithinLimit(text, target, locale)
			files.push({ path, target, locale })
		}
	}

	return { version, files }
}
