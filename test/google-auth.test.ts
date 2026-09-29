import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { fetchAccessToken, parseServiceAccountJson } from '../src/stores/google/auth.js'

function base64urlDecode(input: string): Buffer {
	const padded = input.replace(/-/g, '+').replace(/_/g, '/')
	return Buffer.from(padded, 'base64')
}

describe('parseServiceAccountJson', () => {
	it('parseia um JSON válido', () => {
		const account = parseServiceAccountJson(JSON.stringify({ client_email: 'a@b.com', private_key: 'x' }))
		expect(account.client_email).toBe('a@b.com')
	})

	it('rejeita JSON sem client_email/private_key', () => {
		expect(() => parseServiceAccountJson(JSON.stringify({ foo: 'bar' }))).toThrow()
	})

	it('rejeita JSON malformado', () => {
		expect(() => parseServiceAccountJson('{not json')).toThrow()
	})
})

describe('fetchAccessToken', () => {
	it('assina um JWT RS256 válido e troca por access_token via fetch mockado', async () => {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
		const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

		let capturedAssertion: string | undefined
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			const body = new URLSearchParams(init.body as string)
			capturedAssertion = body.get('assertion') ?? undefined
			expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
			return new Response(JSON.stringify({ access_token: 'fake-token' }), { status: 200 })
		})

		const token = await fetchAccessToken({ client_email: 'sa@project.iam.gserviceaccount.com', private_key: privateKeyPem }, fetchMock as unknown as typeof fetch)
		expect(token).toBe('fake-token')

		const [headerB64, payloadB64, signatureB64] = capturedAssertion!.split('.')
		const payload = JSON.parse(base64urlDecode(payloadB64!).toString('utf8'))
		expect(payload.iss).toBe('sa@project.iam.gserviceaccount.com')
		expect(payload.scope).toBe('https://www.googleapis.com/auth/androidpublisher')

		const verifier = createVerify('RSA-SHA256')
		verifier.update(`${headerB64}.${payloadB64}`)
		verifier.end()
		expect(verifier.verify(publicKey, base64urlDecode(signatureB64!))).toBe(true)
	})

	it('falha com mensagem clara quando o Google recusa', async () => {
		const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
		const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
		const fetchMock = vi.fn(async () => new Response('invalid_grant', { status: 400 }))
		await expect(
			fetchAccessToken({ client_email: 'sa@project.iam.gserviceaccount.com', private_key: privateKeyPem }, fetchMock as unknown as typeof fetch)
		).rejects.toThrow(/access_token/)
	})
})
