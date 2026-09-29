import { describe, expect, it } from 'vitest'
import { assertNotesWithinLimit, APPLE_WHATS_NEW_MAX, PLAY_NOTES_MAX } from '../src/notes/limits.js'
import { draftNotes } from '../src/notes/draft.js'
import type { CommitEntry } from '../src/git/commits.js'

describe('notes/limits', () => {
	it('aceita texto dentro do limite', () => {
		expect(() => assertNotesWithinLimit('ok', 'play', 'pt-BR')).not.toThrow()
	})

	it('rejeita texto vazio', () => {
		expect(() => assertNotesWithinLimit('   ', 'play', 'pt-BR')).toThrow(/vazias/)
	})

	it('rejeita Play acima de 500 chars', () => {
		expect(() => assertNotesWithinLimit('a'.repeat(PLAY_NOTES_MAX + 1), 'play', 'pt-BR')).toThrow(/500/)
	})

	it('rejeita Apple acima de 4000 chars', () => {
		expect(() => assertNotesWithinLimit('a'.repeat(APPLE_WHATS_NEW_MAX + 1), 'ios', 'pt-BR')).toThrow(/4000/)
	})
})

describe('draftNotes', () => {
	const commits: CommitEntry[] = [
		{ sha: 'a1', subject: 'feat(app): adiciona login por código', type: 'feat', scope: 'app', description: 'adiciona login por código' },
		{ sha: 'a2', subject: 'fix(app): corrige crash no compartilhamento', type: 'fix', scope: 'app', description: 'corrige crash no compartilhamento' },
		{ sha: 'a3', subject: 'chore: bump deps', type: 'chore', scope: null, description: 'bump deps' },
	]

	it('separa novidades e correções, ignora chores', () => {
		const draft = draftNotes(commits, '1.2.0')
		expect(draft).toContain('Novidades:')
		expect(draft).toContain('Adiciona login por código')
		expect(draft).toContain('Correções:')
		expect(draft).toContain('Corrige crash no compartilhamento')
		expect(draft).not.toContain('bump deps')
	})

	it('avisa quando não há commits feat/fix', () => {
		const draft = draftNotes([], '1.2.0')
		expect(draft).toContain('sem commits feat/fix')
	})
})
