import { describe, expect, it, vi } from 'vitest'
import { submitForReview } from '../src/stores/apple/review.js'
import type { AppStoreConnectClient } from '../src/stores/apple/client.js'

interface Route {
	match: (method: string, path: string) => boolean
	respond: (method: string, path: string, body?: unknown) => unknown
}

function routedClient(routes: Route[]): AppStoreConnectClient {
	const request = vi.fn(async (method: string, path: string, body?: unknown) => {
		const route = routes.find((r) => r.match(method, path))
		if (!route) throw new Error(`sem rota mockada para ${method} ${path}`)
		return route.respond(method, path, body)
	})
	return {
		request,
		get: (path: string) => request('GET', path),
		post: (path: string, body: unknown) => request('POST', path, body),
		patch: (path: string, body: unknown) => request('PATCH', path, body),
	} as unknown as AppStoreConnectClient
}

describe('submitForReview', () => {
	it('fluxo completo: cria versão, seleciona build, preenche whatsNew, envia review', async () => {
		const client = routedClient([
			{ match: (m, p) => m === 'GET' && p.startsWith('/apps?filter[bundleId]='), respond: () => ({ data: [{ id: 'app-1', attributes: { name: 'App' } }] }) },
			{ match: (m, p) => m === 'GET' && p.includes('/reviewSubmissions?'), respond: () => ({ data: [] }) },
			{
				match: (m, p) => m === 'GET' && p.includes('/appStoreVersions?filter[versionString]'),
				respond: () => ({ data: [] }),
			},
			{
				match: (m, p) => m === 'POST' && p === '/appStoreVersions',
				respond: () => ({ data: { id: 'version-1', attributes: { versionString: '1.2.0', platform: 'IOS' } } }),
			},
			{ match: (m, p) => m === 'PATCH' && p === '/appStoreVersions/version-1', respond: () => ({}) },
			{
				match: (m, p) => m === 'GET' && p.includes('/builds?filter[app]=app-1'),
				respond: () => ({ data: [{ id: 'build-1', attributes: { processingState: 'VALID', version: '1.2.0' } }] }),
			},
			{ match: (m, p) => m === 'POST' && p === '/appStoreVersions/version-1/relationships/build', respond: () => ({}) },
			{ match: (m, p) => m === 'POST' && p === '/appStoreVersionPhasedReleases', respond: () => ({}) },
			{
				match: (m, p) => m === 'GET' && p === '/appStoreVersions/version-1/appStoreVersionLocalizations',
				respond: () => ({ data: [{ id: 'loc-1', attributes: { locale: 'pt-BR' } }] }),
			},
			{ match: (m, p) => m === 'PATCH' && p === '/appStoreVersionLocalizations/loc-1', respond: () => ({}) },
			{
				match: (m, p) => m === 'POST' && p === '/reviewSubmissions',
				respond: () => ({ data: { id: 'sub-1', attributes: { platform: 'IOS', state: 'READY_FOR_REVIEW' } } }),
			},
			{ match: (m, p) => m === 'POST' && p === '/reviewSubmissionItems', respond: () => ({}) },
			{
				match: (m, p) => m === 'PATCH' && p === '/reviewSubmissions/sub-1',
				respond: () => ({ data: { id: 'sub-1', attributes: { platform: 'IOS', state: 'WAITING_FOR_REVIEW', submitted: true } } }),
			},
		])

		const result = await submitForReview(client, {
			bundleId: 'com.app',
			versionString: '1.2.0',
			whatsNewByLocale: { 'pt-BR': 'novidades' },
			phasedRelease: true,
		})

		expect(result.alreadyInProgress).toBe(false)
		expect(result.appStoreVersionId).toBe('version-1')
		expect(result.buildId).toBe('build-1')
		expect(result.submissionId).toBe('sub-1')
		expect(result.state).toBe('WAITING_FOR_REVIEW')
	})

	it('retorna curto-circuito quando já existe uma submission em andamento', async () => {
		const client = routedClient([
			{ match: (m, p) => m === 'GET' && p.startsWith('/apps?filter[bundleId]='), respond: () => ({ data: [{ id: 'app-1', attributes: { name: 'App' } }] }) },
			{
				match: (m, p) => m === 'GET' && p.includes('/reviewSubmissions?'),
				respond: () => ({ data: [{ id: 'sub-existing', attributes: { platform: 'IOS', state: 'IN_REVIEW' } }] }),
			},
		])

		const result = await submitForReview(client, { bundleId: 'com.app', versionString: '1.2.0', whatsNewByLocale: { 'pt-BR': 'x' } })
		expect(result.alreadyInProgress).toBe(true)
		expect(result.submissionId).toBe('sub-existing')
		expect(result.state).toBe('IN_REVIEW')
	})

	it('falha com mensagem clara quando o app não existe', async () => {
		const client = routedClient([{ match: (m, p) => m === 'GET' && p.startsWith('/apps?filter[bundleId]='), respond: () => ({ data: [] }) }])
		await expect(submitForReview(client, { bundleId: 'com.app', versionString: '1.2.0', whatsNewByLocale: {} })).rejects.toThrow(/não encontrado/)
	})
})
