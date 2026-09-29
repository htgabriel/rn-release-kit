import { fail } from '../../exec/run.js'
import { fetchAccessToken, type GoogleServiceAccount } from './auth.js'

export const ANDROID_PUBLISHER_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3'

export type FetchLike = typeof fetch

export interface AndroidPublisherClientOptions {
	account: GoogleServiceAccount
	baseUrl?: string
	fetchImpl?: FetchLike
}

/** Cliente fino para a Android Publisher API v3 — sem googleapis/SDK. */
export class AndroidPublisherClient {
	private readonly account: GoogleServiceAccount
	private readonly baseUrl: string
	private readonly fetchImpl: FetchLike
	private cachedToken: string | null = null

	constructor(options: AndroidPublisherClientOptions) {
		this.account = options.account
		this.baseUrl = options.baseUrl ?? ANDROID_PUBLISHER_BASE
		this.fetchImpl = options.fetchImpl ?? fetch
	}

	private async token(): Promise<string> {
		if (!this.cachedToken) {
			this.cachedToken = await fetchAccessToken(this.account, this.fetchImpl)
		}
		return this.cachedToken
	}

	async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const token = await this.token()
		const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: body ? JSON.stringify(body) : undefined,
		})
		const text = await response.text()
		if (!response.ok) fail(`Android Publisher API ${method} ${path} → ${response.status}\n${text}`)
		if (!text) return undefined as T
		return JSON.parse(text) as T
	}

	get<T>(path: string): Promise<T> {
		return this.request<T>('GET', path)
	}

	put<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('PUT', path, body)
	}

	post<T>(path: string, body?: unknown): Promise<T> {
		return this.request<T>('POST', path, body)
	}

	delete<T>(path: string): Promise<T> {
		return this.request<T>('DELETE', path)
	}
}
