import { fail } from '../exec/run.js'

export const PLAY_NOTES_MAX = 500
export const APPLE_WHATS_NEW_MAX = 4000

export type NotesTarget = 'ios' | 'play'

export function notesMaxFor(target: NotesTarget): number {
	return target === 'play' ? PLAY_NOTES_MAX : APPLE_WHATS_NEW_MAX
}

export function assertNotesWithinLimit(text: string, target: NotesTarget, locale: string): void {
	const max = notesMaxFor(target)
	if (text.length > max) {
		fail(`Notas ${target} (${locale}) têm ${text.length} caracteres (máximo ${max}).`)
	}
	if (!text.trim()) {
		fail(`Notas ${target} (${locale}) estão vazias.`)
	}
}
