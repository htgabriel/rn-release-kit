import { fail } from '../../exec/run.js'
import { PLAY_NOTES_MAX } from '../../notes/limits.js'
import type { AndroidPublisherClient } from './client.js'

export interface PlayRelease {
	name?: string
	versionCodes?: string[]
	status: 'completed' | 'inProgress' | 'halted' | 'draft'
	releaseNotes?: Array<{ language: string; text: string }>
	userFraction?: number
}

export interface PlayTrack {
	track: string
	releases?: PlayRelease[]
}

interface EditHandle {
	id: string
}

/** Toda operação de escrita na Play precisa de um "edit" — insere, aplica, comita. */
async function withEdit<T>(
	client: AndroidPublisherClient,
	packageName: string,
	fn: (editId: string) => Promise<T>
): Promise<T> {
	const edit = await client.post<EditHandle>(`/applications/${packageName}/edits`)
	try {
		const result = await fn(edit.id)
		await client.post(`/applications/${packageName}/edits/${edit.id}:commit`)
		return result
	} catch (error) {
		await client.delete(`/applications/${packageName}/edits/${edit.id}`).catch(() => {})
		throw error
	}
}

/** Leitura: insere o edit só pra ver o estado atual e descarta sem comitar. */
async function withReadOnlyEdit<T>(
	client: AndroidPublisherClient,
	packageName: string,
	fn: (editId: string) => Promise<T>
): Promise<T> {
	const edit = await client.post<EditHandle>(`/applications/${packageName}/edits`)
	try {
		return await fn(edit.id)
	} finally {
		await client.delete(`/applications/${packageName}/edits/${edit.id}`).catch(() => {})
	}
}

function findTargetRelease(releases: PlayRelease[], versionCode?: string): PlayRelease | undefined {
	if (versionCode) {
		return releases.find((release) => (release.versionCodes ?? []).includes(String(versionCode)))
	}
	return releases.find((release) => release.status === 'completed') ?? releases[0]
}

/** Valida acesso ao app: insere e descarta um edit vazio (usado no wizard). */
export async function validatePlayAccess(client: AndroidPublisherClient, packageName: string): Promise<void> {
	await withReadOnlyEdit(client, packageName, async () => undefined)
}

export interface UpdateTrackNotesInput {
	packageName: string
	track: string
	notesByLocale: Record<string, string>
	versionCode?: string
}

/** Porta de `play_update_notes.rb`: atualiza releaseNotes sem reupload de AAB. */
export async function updateTrackNotes(client: AndroidPublisherClient, input: UpdateTrackNotesInput): Promise<PlayRelease> {
	for (const [locale, text] of Object.entries(input.notesByLocale)) {
		if (text.length > PLAY_NOTES_MAX) fail(`notas Play (${locale}) têm ${text.length} chars (máximo ${PLAY_NOTES_MAX}).`)
	}
	return withEdit(client, input.packageName, async (editId) => {
		const track = await client.get<PlayTrack>(`/applications/${input.packageName}/edits/${editId}/tracks/${input.track}`)
		const releases = track.releases ?? []
		const target = findTargetRelease(releases, input.versionCode)
		if (!target) fail(`faixa ${input.track} sem releases (versionCode: ${input.versionCode ?? '(completed)'}).`)
		target.releaseNotes = Object.entries(input.notesByLocale).map(([language, text]) => ({ language, text }))
		await client.put(`/applications/${input.packageName}/edits/${editId}/tracks/${input.track}`, {
			track: input.track,
			releases,
		})
		return target
	})
}

export interface PromoteReleaseInput {
	packageName: string
	fromTrack: string
	toTrack: string
	notesByLocale?: Record<string, string>
	/** 0 < x < 1 inicia em rollout parcial; 1 (default) publica 100%. */
	initialRollout?: number
}

/** Copia a release "completed" da faixa de teste para a faixa de produção, sem reupload de AAB. */
export async function promoteRelease(client: AndroidPublisherClient, input: PromoteReleaseInput): Promise<PlayRelease> {
	return withEdit(client, input.packageName, async (editId) => {
		const source = await client.get<PlayTrack>(`/applications/${input.packageName}/edits/${editId}/tracks/${input.fromTrack}`)
		const releases = source.releases ?? []
		const target = findTargetRelease(releases)
		if (!target || !target.versionCodes?.length) {
			fail(`faixa ${input.fromTrack} sem release para promover.`)
		}
		const fraction = input.initialRollout ?? 1
		const status: PlayRelease['status'] = fraction < 1 ? 'inProgress' : 'completed'
		const releaseNotes = input.notesByLocale
			? Object.entries(input.notesByLocale).map(([language, text]) => ({ language, text }))
			: target!.releaseNotes
		const newRelease: PlayRelease = {
			versionCodes: target!.versionCodes,
			status,
			releaseNotes,
			...(status === 'inProgress' ? { userFraction: fraction } : {}),
		}
		await client.put(`/applications/${input.packageName}/edits/${editId}/tracks/${input.toTrack}`, {
			track: input.toTrack,
			releases: [newRelease],
		})
		return newRelease
	})
}

export type RolloutTarget = number | 'complete' | 'halt'

/** Avança/pausa/completa o rollout em uma faixa já em `inProgress`. */
export async function setRollout(client: AndroidPublisherClient, packageName: string, track: string, target: RolloutTarget): Promise<PlayRelease> {
	return withEdit(client, packageName, async (editId) => {
		const current = await client.get<PlayTrack>(`/applications/${packageName}/edits/${editId}/tracks/${track}`)
		const releases = current.releases ?? []
		const active = releases.find((release) => release.status === 'inProgress') ?? releases[releases.length - 1]
		if (!active) fail(`faixa ${track} sem release em rollout.`)

		if (target === 'complete') {
			active.status = 'completed'
			delete active.userFraction
		} else if (target === 'halt') {
			active.status = 'halted'
		} else {
			if (target <= 0 || target > 1) fail(`--to precisa ser um valor entre 0 e 1 (ou complete/halt).`)
			active.status = 'inProgress'
			active.userFraction = target
		}

		await client.put(`/applications/${packageName}/edits/${editId}/tracks/${track}`, { track, releases })
		return active
	})
}

export async function getTrackStatus(client: AndroidPublisherClient, packageName: string, track: string): Promise<PlayTrack> {
	return withReadOnlyEdit(client, packageName, (editId) =>
		client.get<PlayTrack>(`/applications/${packageName}/edits/${editId}/tracks/${track}`)
	)
}
