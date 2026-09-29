import { fail } from '../../exec/run.js'
import { createAppStoreConnectToken, type AppStoreConnectCredentials } from './auth.js'

export const APP_STORE_CONNECT_BASE = 'https://api.appstoreconnect.apple.com/v1'

export type FetchLike = typeof fetch

export interface AppStoreConnectClientOptions {
	credentials: AppStoreConnectCredentials
	baseUrl?: string
	fetchImpl?: FetchLike
}

export interface JsonApiDocument<TAttributes = Record<string, unknown>> {
	data: {
		id: string
		type: string
		attributes: TAttributes
		relationships?: Record<string, unknown>
	}
}

export interface JsonApiCollection<TAttributes = Record<string, unknown>> {
	data: Array<{
		id: string
		type: string
		attributes: TAttributes
		relationships?: Record<string, unknown>
	}>
	links?: { next?: string }
}

/**
 * Cliente fino para a App Store Connect API. Sem SDK — todo o resto do
 * módulo `stores/apple` fala só com os métodos abaixo, então trocar de HTTP
 * client ou mockar em teste é local a este arquivo.
 */
export class AppStoreConnectClient {
	private readonly credentials: AppStoreConnectCredentials
	private readonly baseUrl: string
	private readonly fetchImpl: FetchLike

	constructor(options: AppStoreConnectClientOptions) {
		this.credentials = options.credentials
		this.baseUrl = options.baseUrl ?? APP_STORE_CONNECT_BASE
		this.fetchImpl = options.fetchImpl ?? fetch
	}

	private token(): string {
		return createAppStoreConnectToken(this.credentials)
	}

	async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
		const response = await this.fetchImpl(url, {
			method,
			headers: {
				Authorization: `Bearer ${this.token()}`,
				'Content-Type': 'application/json',
			},
			body: body ? JSON.stringify(body) : undefined,
		})
		const text = await response.text()
		if (!response.ok) {
			fail(`App Store Connect API ${method} ${path} → ${response.status}\n${text}`)
		}
		if (!text) return undefined as T
		return JSON.parse(text) as T
	}

	get<T>(path: string): Promise<T> {
		return this.request<T>('GET', path)
	}

	post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('POST', path, body)
	}

	patch<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('PATCH', path, body)
	}
}
