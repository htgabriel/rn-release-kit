import { fail } from '../exec/run.js'

interface EasBuildProfileRaw {
	extends?: string
	android?: { buildType?: string }
	ios?: { distribution?: string }
	environment?: string
	autoIncrement?: boolean
	[key: string]: unknown
}

/**
 * Resolve a cadeia de `extends` de um build profile do eas.json (o EAS
 * suporta um nível de herança). Devolve o profile com os campos herdados
 * já mesclados (o filho ganha de quem ele estende).
 */
export function resolveBuildProfileChain(easJson: Record<string, unknown>, profileName: string): EasBuildProfileRaw {
	const build = (easJson.build as Record<string, EasBuildProfileRaw> | undefined) ?? {}
	const profile = build[profileName]
	if (!profile) fail(`build profile "${profileName}" não existe no eas.json.`)

	const chain: EasBuildProfileRaw[] = [profile]
	let cursor: EasBuildProfileRaw | undefined = profile
	const seen = new Set([profileName])
	while (cursor?.extends) {
		const parentName: string = cursor.extends
		if (seen.has(parentName)) break
		seen.add(parentName)
		const parent: EasBuildProfileRaw | undefined = build[parentName]
		if (!parent) break
		chain.push(parent)
		cursor = parent
	}

	// merge do mais genérico (base) pro mais específico
	const merged: EasBuildProfileRaw = {}
	for (const step of chain.slice().reverse()) {
		Object.assign(merged, step)
		if (step.android) merged.android = { ...merged.android, ...step.android }
		if (step.ios) merged.ios = { ...merged.ios, ...step.ios }
	}
	return merged
}

export function androidBuildTypeExt(easJson: Record<string, unknown>, profileName: string): 'apk' | 'aab' {
	const resolved = resolveBuildProfileChain(easJson, profileName)
	return resolved.android?.buildType === 'apk' ? 'apk' : 'aab'
}
