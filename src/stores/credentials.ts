import { existsSync, readFileSync } from 'node:fs'
import { fail } from '../exec/run.js'
import { resolveFileCredential } from '../env/store.js'
import { AppStoreConnectClient } from './apple/client.js'
import { AndroidPublisherClient } from './google/client.js'
import { parseServiceAccountJson } from './google/auth.js'

export interface Cleanup {
	cleanup: () => void
}

export function createAppleClient(env: NodeJS.ProcessEnv): AppStoreConnectClient & Cleanup {
	const keyId = env.ASC_KEY_ID
	const issuerId = env.ASC_ISSUER_ID
	if (!keyId || !issuerId) {
		fail('Credenciais App Store Connect ausentes: ASC_KEY_ID, ASC_ISSUER_ID. Rode `release-kit credentials apple`.')
	}
	const resolved = resolveFileCredential(env, 'ASC_KEY_PATH', 'ASC_KEY_P8_CONTENT', 'AuthKey.p8')
	if (!resolved) {
		fail('Credencial ASC_KEY_PATH (ou ASC_KEY_P8_CONTENT em CI) ausente. Rode `release-kit credentials apple`.')
	}
	if (!existsSync(resolved.path)) fail(`ASC_KEY_PATH não existe: ${resolved.path}`)
	const privateKeyPem = readFileSync(resolved.path, 'utf8')
	const client = new AppStoreConnectClient({ credentials: { keyId, issuerId, privateKeyPem } })
	return Object.assign(client, { cleanup: resolved.cleanup })
}

export function createGoogleClient(env: NodeJS.ProcessEnv): AndroidPublisherClient & Cleanup {
	const resolved = resolveFileCredential(env, 'GOOGLE_PLAY_JSON_KEY', 'GOOGLE_PLAY_JSON_CONTENT', 'play-service-account.json')
	if (!resolved) {
		fail(
			'Credencial GOOGLE_PLAY_JSON_KEY (ou GOOGLE_PLAY_JSON_CONTENT em CI) ausente. Rode `release-kit credentials google`.'
		)
	}
	if (!existsSync(resolved.path)) fail(`GOOGLE_PLAY_JSON_KEY não existe: ${resolved.path}`)
	const account = parseServiceAccountJson(readFileSync(resolved.path, 'utf8'))
	const client = new AndroidPublisherClient({ account })
	return Object.assign(client, { cleanup: resolved.cleanup })
}
