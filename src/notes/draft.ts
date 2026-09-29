import type { CommitEntry } from '../git/commits.js'
import { userFacingCommits } from '../git/commits.js'

/**
 * Rascunho a partir dos commits (feat/fix) desde a última tag. Não traduz
 * nem reescreve em linguagem de usuário — é ponto de partida para editar
 * no $EDITOR, não o texto final.
 */
export function draftNotes(commits: CommitEntry[], version: string): string {
	const facing = userFacingCommits(commits)
	if (facing.length === 0) {
		return `Novidades da versão ${version}\n\n(sem commits feat/fix desde a última tag — escreva as notas manualmente)\n`
	}
	const features = facing.filter((c) => c.type === 'feat')
	const fixes = facing.filter((c) => c.type === 'fix')
	const lines: string[] = [`Novidades da versão ${version}`, '']
	if (features.length) {
		lines.push('Novidades:')
		for (const commit of features) lines.push(`- ${capitalize(commit.description)}`)
		lines.push('')
	}
	if (fixes.length) {
		lines.push('Correções:')
		for (const commit of fixes) lines.push(`- ${capitalize(commit.description)}`)
		lines.push('')
	}
	lines.push('# Revise este rascunho antes de publicar — ele vem direto dos commits (feat/fix) e não foi reescrito em linguagem de usuário.')
	return lines.join('\n')
}

function capitalize(text: string): string {
	if (!text) return text
	return text[0]!.toUpperCase() + text.slice(1)
}
