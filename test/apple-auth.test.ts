import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createAppStoreConnectToken } from '../src/stores/apple/auth.js'

function base64urlDecode(input: string): Buffer {
	const padded = input.replace(/-/g, '+').replace(/_/g, '/')
	return Buffer.from(padded, 'base64')
}

describe('createAppStoreConnectToken', () => {
	it('gera um JWT ES256 com header/payload/assinatura válidos', () => {
		const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
		const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

		const token = createAppStoreConnectToken({ keyId: 'ABC123', issuerId: 'issuer-xyz', privateKeyPem })
		const [headerB64, payloadB64, signatureB64] = token.split('.')
		expect(headerB64).toBeTruthy()
		expect(payloadB64).toBeTruthy()
		expect(signatureB64).toBeTruthy()

		const header = JSON.parse(base64urlDecode(headerB64!).toString('utf8'))
		expect(header).toEqual({ alg: 'ES256', kid: 'ABC123', typ: 'JWT' })

		const payload = JSON.parse(base64urlDecode(payloadB64!).toString('utf8'))
		expect(payload.iss).toBe('issuer-xyz')
		expect(payload.aud).toBe('appstoreconnect-v1')
		expect(payload.exp - payload.iat).toBe(19 * 60)

		const verifier = createVerify('SHA256')
		verifier.update(`${headerB64}.${payloadB64}`)
		verifier.end()
		const signature = base64urlDecode(signatureB64!)
		const valid = verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)
		expect(valid).toBe(true)
	})
})
