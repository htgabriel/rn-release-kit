import { createPrivateKey, createSign } from 'node:crypto'

export interface AppStoreConnectCredentials {
	keyId: string
	issuerId: string
	/** Conteúdo do arquivo .p8 (PEM), não o path. */
	privateKeyPem: string
}

function base64url(input: Buffer | string): string {
	const buffer = typeof input === 'string' ? Buffer.from(input) : input
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * JWT ES256 exigido pela App Store Connect API. Sem SDK (Spaceship) —
 * assinatura via node:crypto puro, então funciona igual em qualquer SO.
 * Expira em 20 minutos (o máximo aceito pela Apple); gerar um novo por
 * chamada evita lidar com relógio/cache entre processos.
 */
export function createAppStoreConnectToken(credentials: AppStoreConnectCredentials, now: number = Date.now()): string {
	const iat = Math.floor(now / 1000)
	const exp = iat + 19 * 60

	const header = base64url(JSON.stringify({ alg: 'ES256', kid: credentials.keyId, typ: 'JWT' }))
	const payload = base64url(
		JSON.stringify({
			iss: credentials.issuerId,
			iat,
			exp,
			aud: 'appstoreconnect-v1',
		})
	)
	const signingInput = `${header}.${payload}`

	const key = createPrivateKey({ key: credentials.privateKeyPem, format: 'pem' })
	const signer = createSign('SHA256')
	signer.update(signingInput)
	signer.end()
	// dsaEncoding "ieee-p1363" devolve r||s cru (o formato que JWS ES256 exige),
	// em vez do DER que createSign produz por padrão.
	const signature = signer.sign({ key, dsaEncoding: 'ieee-p1363' })

	return `${signingInput}.${base64url(signature)}`
}
