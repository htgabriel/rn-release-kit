import { fail } from '../../exec/run.js'
import type { AppStoreConnectClient, JsonApiCollection } from './client.js'

export interface AppAttributes {
	bundleId: string
	name: string
}

/** GET /v1/apps?filter[bundleId]= — usado no wizard pra achar o ascAppId automaticamente. */
export async function findAppByBundleId(client: AppStoreConnectClient, bundleId: string): Promise<{ id: string; name: string } | null> {
	const result = await client.get<JsonApiCollection<AppAttributes>>(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`)
	const [app] = result.data
	if (!app) return null
	return { id: app.id, name: app.attributes.name }
}

export async function requireAppByBundleId(client: AppStoreConnectClient, bundleId: string): Promise<{ id: string; name: string }> {
	const app = await findAppByBundleId(client, bundleId)
	if (!app) fail(`App com bundleId ${bundleId} não encontrado no App Store Connect (chave sem acesso ao app, ou app ainda não criado).`)
	return app
}
