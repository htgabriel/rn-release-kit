import { describe, expect, it, vi } from 'vitest'
import { getIosStatus, submitForReview } from '../src/stores/apple/review.js'
import type { AppStoreConnectClient } from '../src/stores/apple/client.js'

interface Route {
	match: (method: string, path: string) => boolean
	respond: (method: string, path: string, body?: unknown) => unknown
}

interface Call {
	method: string
	path: string
	body?: unknown
}

function routedClient(routes: Route[]): { client: AppStoreConnectClient; calls: Call[] } {
	const calls: Call[] = []
	const request = vi.fn(async (method: string, path: string, body?: unknown) => {
		calls.push({ method, path, body })
		const route = routes.find((r) => r.match(method, path))
		if (!route) throw new Error(`sem rota mockada para ${method} ${path}`)
		return route.respond(method, path, body)
	})
	const client = {
		request,
		get: (path: string) => request('GET', path),
		post: (path: string, body: unknown) => request('POST', path, body),
		patch: (path: string, body: unknown) => request('PATCH', path, body),
	} as unknown as AppStoreConnectClient
	return { client, calls }
}

function route(method: string, path: string | RegExp, data: unknown): Route {
	return {
		match: (m, p) => m === method && (typeof path === 'string' ? p === path : path.test(p)),
		respond: () => data,
	}
}

const VERSION_BY_NUMBER = /\/apps\/app-1\/appStoreVersions\?filter\[versionString\]=/
const EDITABLE_VERSION = /\/apps\/app-1\/appStoreVersions\?filter\[appStoreState\]=[^&]*PREPARE_FOR_SUBMISSION/
const REVIEW_SUBMISSIONS = /\/apps\/app-1\/reviewSubmissions\?/
const DRAFT_ITEMS = /^\/reviewSubmissions\/sub-draft\/items\?/

const version350 = { id: 'version-1', attributes: { versionString: '3.5.0', platform: 'IOS', appStoreState: 'PREPARE_FOR_SUBMISSION' } }
const draft = { id: 'sub-draft', attributes: { platform: 'IOS', state: 'READY_FOR_REVIEW' } }
const itemForVersion1 = { id: 'item-1', relationships: { appStoreVersion: { data: { id: 'version-1', type: 'appStoreVersions' } } } }

/** Conta sem versão nem submission: cada teste sobrepõe só as rotas que importam (a primeira que casa vence). */
function baseRoutes(): Route[] {
	return [
		route('GET', /^\/apps\?filter\[bundleId\]=/, { data: [{ id: 'app-1', attributes: { name: 'App' } }] }),
		route('GET', REVIEW_SUBMISSIONS, { data: [] }),
		route('GET', VERSION_BY_NUMBER, { data: [] }),
		route('GET', EDITABLE_VERSION, { data: [] }),
		route('POST', '/appStoreVersions', { data: { id: 'version-1', attributes: { versionString: '3.5.1', platform: 'IOS' } } }),
		route('PATCH', '/appStoreVersions/version-1', {}),
		route('GET', /^\/builds\?filter\[app\]=app-1/, { data: [{ id: 'build-1', attributes: { processingState: 'VALID', version: '3.5.1' } }] }),
		route('PATCH', '/appStoreVersions/version-1/relationships/build', undefined),
		route('GET', '/appStoreVersions/version-1/appStoreVersionPhasedRelease', { data: null }),
		route('POST', '/appStoreVersionPhasedReleases', {}),
		route('GET', '/appStoreVersions/version-1/appStoreVersionLocalizations', { data: [{ id: 'loc-1', attributes: { locale: 'pt-BR' } }] }),
		route('PATCH', '/appStoreVersionLocalizations/loc-1', {}),
		route('POST', '/reviewSubmissions', { data: { id: 'sub-new', attributes: { platform: 'IOS', state: 'READY_FOR_REVIEW' } } }),
		route('POST', '/reviewSubmissionItems', {}),
		route('PATCH', '/reviewSubmissions/sub-new', { data: { id: 'sub-new', attributes: { platform: 'IOS', state: 'WAITING_FOR_REVIEW' } } }),
		route('GET', DRAFT_ITEMS, { data: [] }),
		route('PATCH', '/reviewSubmissions/sub-draft', { data: { id: 'sub-draft', attributes: { platform: 'IOS', state: 'WAITING_FOR_REVIEW' } } }),
	]
}

const input = { bundleId: 'com.app', versionString: '3.5.1', whatsNewByLocale: { 'pt-BR': 'novidades' } }

function writes(calls: Call[], method: string, path: string): Call[] {
	return calls.filter((c) => c.method === method && c.path === path)
}

function versionAttributesSent(calls: Call[]): Array<Record<string, unknown>> {
	return writes(calls, 'PATCH', '/appStoreVersions/version-1').map(
		(c) => (c.body as { data: { attributes: Record<string, unknown> } }).data.attributes
	)
}

describe('submitForReview', () => {
	it('fluxo completo sem versão nem rascunho: cria versão e submission, e envia', async () => {
		const { client, calls } = routedClient(baseRoutes())

		const result = await submitForReview(client, { ...input, phasedRelease: true })

		expect(writes(calls, 'POST', '/appStoreVersions')).toHaveLength(1)
		expect(writes(calls, 'POST', '/reviewSubmissions')).toHaveLength(1)
		expect(writes(calls, 'POST', '/reviewSubmissionItems')).toHaveLength(1)
		expect(writes(calls, 'PATCH', '/reviewSubmissions/sub-new')[0]?.body).toEqual({
			data: { id: 'sub-new', type: 'reviewSubmissions', attributes: { submitted: true } },
		})
		expect(result).toMatchObject({
			alreadyInProgress: false,
			appStoreVersionId: 'version-1',
			buildId: 'build-1',
			submissionId: 'sub-new',
			state: 'WAITING_FOR_REVIEW',
		})
	})

	it('rascunho READY_FOR_REVIEW com versão editável de outro número: renomeia, reaproveita e envia', async () => {
		const { client, calls } = routedClient([
			route('GET', REVIEW_SUBMISSIONS, { data: [draft] }),
			route('GET', EDITABLE_VERSION, { data: [version350] }),
			route('GET', DRAFT_ITEMS, { data: [itemForVersion1] }),
			...baseRoutes(),
		])

		const result = await submitForReview(client, { ...input, phasedRelease: true })

		expect(writes(calls, 'POST', '/appStoreVersions')).toHaveLength(0)
		expect(writes(calls, 'POST', '/reviewSubmissions')).toHaveLength(0)
		expect(writes(calls, 'POST', '/reviewSubmissionItems')).toHaveLength(0)
		expect(versionAttributesSent(calls)).toEqual(expect.arrayContaining([{ versionString: '3.5.1' }, { releaseType: 'MANUAL' }]))
		expect(writes(calls, 'PATCH', '/appStoreVersionLocalizations/loc-1')[0]?.body).toEqual({
			data: { id: 'loc-1', type: 'appStoreVersionLocalizations', attributes: { whatsNew: 'novidades' } },
		})
		expect(writes(calls, 'PATCH', '/reviewSubmissions/sub-draft')[0]?.body).toEqual({
			data: { id: 'sub-draft', type: 'reviewSubmissions', attributes: { submitted: true } },
		})
		expect(result).toMatchObject({
			alreadyInProgress: false,
			appStoreVersionId: 'version-1',
			buildId: 'build-1',
			submissionId: 'sub-draft',
			state: 'WAITING_FOR_REVIEW',
		})
	})

	it('rascunho sem item da versão: adiciona o item ao próprio rascunho', async () => {
		const otherItem = { id: 'item-event', relationships: { appStoreVersion: { data: null } } }
		const { client, calls } = routedClient([
			route('GET', REVIEW_SUBMISSIONS, { data: [draft] }),
			route('GET', DRAFT_ITEMS, { data: [otherItem] }),
			...baseRoutes(),
		])

		await submitForReview(client, input)

		const [item] = writes(calls, 'POST', '/reviewSubmissionItems')
		expect(item?.body).toMatchObject({
			data: {
				relationships: {
					reviewSubmission: { data: { id: 'sub-draft' } },
					appStoreVersion: { data: { id: 'version-1' } },
				},
			},
		})
		expect(writes(calls, 'POST', '/reviewSubmissions')).toHaveLength(0)
	})

	it.each(['WAITING_FOR_REVIEW', 'IN_REVIEW'])('não mexe em nada quando há submission em %s, mesmo com rascunho', async (state) => {
		const { client, calls } = routedClient([
			route('GET', REVIEW_SUBMISSIONS, { data: [draft, { id: 'sub-existing', attributes: { platform: 'IOS', state } }] }),
			...baseRoutes(),
		])

		const result = await submitForReview(client, input)

		expect(result).toMatchObject({ alreadyInProgress: true, submissionId: 'sub-existing', state })
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
	})

	it('versão com o número pedido já existe: usa ela sem renomear nem criar', async () => {
		const version351 = { id: 'version-1', attributes: { versionString: '3.5.1', platform: 'IOS', appStoreState: 'PREPARE_FOR_SUBMISSION' } }
		const { client, calls } = routedClient([route('GET', VERSION_BY_NUMBER, { data: [version351] }), ...baseRoutes()])

		await submitForReview(client, input)

		expect(writes(calls, 'POST', '/appStoreVersions')).toHaveLength(0)
		expect(versionAttributesSent(calls).filter((a) => 'versionString' in a)).toEqual([])
	})

	it('versão editável de outro número: atualiza o versionString em vez de criar outra', async () => {
		const { client, calls } = routedClient([route('GET', EDITABLE_VERSION, { data: [version350] }), ...baseRoutes()])

		await submitForReview(client, input)

		expect(writes(calls, 'POST', '/appStoreVersions')).toHaveLength(0)
		expect(versionAttributesSent(calls)).toContainEqual({ versionString: '3.5.1' })
	})

	it('sem build no TestFlight: falha antes de renomear a versão editável', async () => {
		const { client, calls } = routedClient([
			route('GET', EDITABLE_VERSION, { data: [version350] }),
			route('GET', /^\/builds\?/, { data: [] }),
			...baseRoutes(),
		])

		await expect(submitForReview(client, input)).rejects.toThrow(/Nenhum build/)
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
	})

	it('associa o build com PATCH em relationships/build', async () => {
		const { client, calls } = routedClient(baseRoutes())

		await submitForReview(client, input)

		const buildCalls = calls.filter((c) => c.path === '/appStoreVersions/version-1/relationships/build')
		expect(buildCalls).toEqual([
			{
				method: 'PATCH',
				path: '/appStoreVersions/version-1/relationships/build',
				body: { data: { id: 'build-1', type: 'builds' } },
			},
		])
	})

	it('lançamento gradual inexistente: cria com phasedReleaseState INACTIVE', async () => {
		const { client, calls } = routedClient(baseRoutes())

		await submitForReview(client, { ...input, phasedRelease: true })

		expect(writes(calls, 'POST', '/appStoreVersionPhasedReleases')[0]?.body).toEqual({
			data: {
				type: 'appStoreVersionPhasedReleases',
				attributes: { phasedReleaseState: 'INACTIVE' },
				relationships: { appStoreVersion: { data: { id: 'version-1', type: 'appStoreVersions' } } },
			},
		})
	})

	it('lançamento gradual já existente: não tenta criar de novo', async () => {
		const { client, calls } = routedClient([
			route('GET', '/appStoreVersions/version-1/appStoreVersionPhasedRelease', {
				data: { id: 'phased-1', attributes: { phasedReleaseState: 'INACTIVE' } },
			}),
			...baseRoutes(),
		])

		await submitForReview(client, { ...input, phasedRelease: true })

		expect(writes(calls, 'POST', '/appStoreVersionPhasedReleases')).toHaveLength(0)
	})

	it('falha com mensagem clara quando o app não existe', async () => {
		const { client } = routedClient([route('GET', /^\/apps\?filter\[bundleId\]=/, { data: [] })])
		await expect(submitForReview(client, { bundleId: 'com.app', versionString: '1.2.0', whatsNewByLocale: {} })).rejects.toThrow(/não encontrado/)
	})
})

describe('getIosStatus', () => {
	it('não apresenta rascunho READY_FOR_REVIEW como submission em andamento', async () => {
		const { client } = routedClient([route('GET', REVIEW_SUBMISSIONS, { data: [draft] }), ...baseRoutes()])
		const status = await getIosStatus(client, 'com.app', '3.5.1')
		expect(status.reviewSubmissionState).toBeNull()
	})

	it('apresenta submission realmente enviada', async () => {
		const { client } = routedClient([
			route('GET', REVIEW_SUBMISSIONS, { data: [{ id: 'sub-1', attributes: { platform: 'IOS', state: 'IN_REVIEW' } }] }),
			...baseRoutes(),
		])
		const status = await getIosStatus(client, 'com.app', '3.5.1')
		expect(status.reviewSubmissionState).toBe('IN_REVIEW')
	})
})
