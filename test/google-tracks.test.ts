import { describe, expect, it, vi } from 'vitest'
import { promoteRelease, setRollout, updateTrackNotes } from '../src/stores/google/tracks.js'
import type { AndroidPublisherClient } from '../src/stores/google/client.js'

function fakeClient(overrides: Partial<Record<'get' | 'put' | 'post' | 'delete', ReturnType<typeof vi.fn>>> = {}) {
	const post = overrides.post ?? vi.fn(async (path: string) => (path.endsWith(':commit') ? undefined : { id: 'edit-1' }))
	const get = overrides.get ?? vi.fn()
	const put = overrides.put ?? vi.fn(async () => undefined)
	const del = overrides.delete ?? vi.fn(async () => undefined)
	return { get, put, post, delete: del } as unknown as AndroidPublisherClient
}

describe('withEdit lifecycle', () => {
	it('comita o edit quando a operação dá certo', async () => {
		const post = vi.fn(async (path: string) => (path.endsWith(':commit') ? undefined : { id: 'edit-1' }))
		const get = vi.fn(async () => ({ track: 'internal', releases: [{ status: 'completed', versionCodes: ['10'], releaseNotes: [] }] }))
		const put = vi.fn(async () => undefined)
		const del = vi.fn(async () => undefined)
		const client = fakeClient({ post, get, put, delete: del })

		await updateTrackNotes(client, { packageName: 'com.app', track: 'internal', notesByLocale: { 'pt-BR': 'novidades' } })

		expect(post).toHaveBeenCalledWith('/applications/com.app/edits')
		expect(post).toHaveBeenCalledWith('/applications/com.app/edits/edit-1:commit')
		expect(del).not.toHaveBeenCalled()
	})

	it('descarta o edit (delete) quando a operação falha', async () => {
		const post = vi.fn(async () => ({ id: 'edit-1' }))
		const get = vi.fn(async () => {
			throw new Error('boom')
		})
		const del = vi.fn(async () => undefined)
		const client = fakeClient({ post, get, delete: del })

		await expect(
			updateTrackNotes(client, { packageName: 'com.app', track: 'internal', notesByLocale: { 'pt-BR': 'x' } })
		).rejects.toThrow('boom')
		expect(del).toHaveBeenCalledWith('/applications/com.app/edits/edit-1')
	})
})

describe('updateTrackNotes', () => {
	it('rejeita notas acima de 500 caracteres antes de abrir o edit', async () => {
		const post = vi.fn()
		const client = fakeClient({ post })
		await expect(
			updateTrackNotes(client, { packageName: 'com.app', track: 'internal', notesByLocale: { 'pt-BR': 'a'.repeat(501) } })
		).rejects.toThrow(/500/)
		expect(post).not.toHaveBeenCalled()
	})
})

describe('promoteRelease', () => {
	it('copia a release completed da faixa de teste com rollout parcial', async () => {
		const get = vi.fn(async () => ({
			track: 'internal',
			releases: [{ status: 'completed', versionCodes: ['42'], releaseNotes: [{ language: 'pt-BR', text: 'old' }] }],
		}))
		const put = vi.fn(async () => undefined)
		const client = fakeClient({ get, put })

		const result = await promoteRelease(client, {
			packageName: 'com.app',
			fromTrack: 'internal',
			toTrack: 'production',
			notesByLocale: { 'pt-BR': 'novo' },
			initialRollout: 0.1,
		})

		expect(result.status).toBe('inProgress')
		expect(result.userFraction).toBe(0.1)
		expect(result.versionCodes).toEqual(['42'])
		expect(put).toHaveBeenCalledWith(
			expect.stringContaining('/tracks/production'),
			expect.objectContaining({ track: 'production' })
		)
	})

	it('publica 100% quando initialRollout é omitido', async () => {
		const get = vi.fn(async () => ({
			track: 'internal',
			releases: [{ status: 'completed', versionCodes: ['42'], releaseNotes: [] }],
		}))
		const client = fakeClient({ get })
		const result = await promoteRelease(client, { packageName: 'com.app', fromTrack: 'internal', toTrack: 'production' })
		expect(result.status).toBe('completed')
		expect(result.userFraction).toBeUndefined()
	})
})

describe('setRollout', () => {
	it('atualiza userFraction em uma release inProgress', async () => {
		const get = vi.fn(async () => ({
			track: 'production',
			releases: [{ status: 'inProgress', versionCodes: ['42'], userFraction: 0.1 }],
		}))
		const put = vi.fn(async () => undefined)
		const client = fakeClient({ get, put })
		const result = await setRollout(client, 'com.app', 'production', 0.5)
		expect(result.userFraction).toBe(0.5)
		expect(result.status).toBe('inProgress')
	})

	it('completa o rollout e remove userFraction', async () => {
		const get = vi.fn(async () => ({
			track: 'production',
			releases: [{ status: 'inProgress', versionCodes: ['42'], userFraction: 0.5 }],
		}))
		const client = fakeClient({ get })
		const result = await setRollout(client, 'com.app', 'production', 'complete')
		expect(result.status).toBe('completed')
		expect(result.userFraction).toBeUndefined()
	})

	it('rejeita fração fora de (0,1]', async () => {
		const get = vi.fn(async () => ({ track: 'production', releases: [{ status: 'inProgress', versionCodes: ['1'] }] }))
		const client = fakeClient({ get })
		await expect(setRollout(client, 'com.app', 'production', 1.5)).rejects.toThrow(/entre 0 e 1/)
	})
})
