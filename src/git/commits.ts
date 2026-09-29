import type { ReleaseKitContext } from '../context.js'
import { git, lastTagMatching } from './policy.js'

export interface CommitEntry {
	sha: string
	subject: string
	type: string | null
	scope: string | null
	description: string
}

const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/

function parseSubject(subject: string): { type: string | null; scope: string | null; description: string } {
	const match = subject.match(CONVENTIONAL_RE)
	if (!match) return { type: null, scope: null, description: subject }
	const [, type, scope, description] = match
	return { type: type ?? null, scope: scope ?? null, description: description ?? subject }
}

/**
 * Lista os commits desde a última tag que casa com `tagFormat` (ou desde o
 * início do histórico, se nenhuma tag existir ainda). Usado para rascunhar
 * as notas de versão.
 */
export function commitsSinceLastTag(ctx: ReleaseKitContext, tagFormat: string): CommitEntry[] {
	const lastTag = lastTagMatching(ctx, tagFormat)
	const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
	const result = git(ctx, ['log', range, '--pretty=format:%h %s'], { allowFail: true })
	if (result.status !== 0) return []
	return result.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [sha, ...rest] = line.split(' ')
			const subject = rest.join(' ')
			const parsed = parseSubject(subject)
			return { sha: sha ?? '', subject, ...parsed }
		})
}

const USER_FACING_TYPES = new Set(['feat', 'fix'])

/** Filtra só o que interessa ao usuário final (feat/fix), descarta o resto. */
export function userFacingCommits(commits: CommitEntry[]): CommitEntry[] {
	return commits.filter((commit) => commit.type && USER_FACING_TYPES.has(commit.type))
}
