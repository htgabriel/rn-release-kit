import { createSign } from 'node:crypto'
import { fail } from '../../exec/run.js'

export interface GoogleServiceAccount {
	client_email: string
	private_key: string
	[key: string]: unknown
}

export function parseServiceAccountJson(raw: string): GoogleServiceAccount {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (error) {
		fail(`JSON da service account inválido: ${(error as Error).message}`)
	}
	const account = parsed as Partial<GoogleServiceAccount>
	if (!account.client_email || !account.private_key) {
		fail('JSON da service account sem client_email/private_key.')
	}
	return account as GoogleServiceAccount
}

function base64url(input: Buffer | string): string {
	const buffer = typeof input === 'string' ? Buffer.from(input) : input
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

/**
 * Fluxo OAuth de service account (JWT bearer, RFC 7523), sem
 * `google-auth-library`: assina um JWT RS256 com a private_key da SA e
 * troca por um access_token de curta duração. node:crypto puro.
 */
export async function fetchAccessToken(
	account: GoogleServiceAccount,
	fetchImpl: typeof fetch = fetch,
	now: number = Date.now()
): Promise<string> {
	const iat = Math.floor(now / 1000)
	const exp = iat + 60 * 60

	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
	const payload = base64url(
		JSON.stringify({
			iss: account.client_email,
			scope: ANDROID_PUBLISHER_SCOPE,
			aud: TOKEN_URL,
			iat,
			exp,
		})
	)
	const signingInput = `${header}.${payload}`
	const signer = createSign('RSA-SHA256')
	signer.update(signingInput)
	signer.end()
	const signature = signer.sign(account.private_key)
	const assertion = `${signingInput}.${base64url(signature)}`

	const response = await fetchImpl(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion,
		}).toString(),
	})
	const text = await response.text()
	if (!response.ok) fail(`Falha ao obter access_token do Google: ${response.status}\n${text}`)
	const json = JSON.parse(text) as { access_token?: string }
	if (!json.access_token) fail('Resposta do Google sem access_token.')
	return json.access_token
}
