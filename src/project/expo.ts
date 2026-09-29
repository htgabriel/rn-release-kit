import type { ReleaseKitContext } from '../context.js'
import { fail } from '../exec/run.js'

export interface ExpoResolvedConfig {
	name: string
	slug: string
	version: string
	android?: { package?: string }
	ios?: { bundleIdentifier?: string }
	extra?: { eas?: { projectId?: string } }
	owner?: string
	[key: string]: unknown
}

/**
 * Roda `npx expo config --json` com o env do canal aplicado, pra descobrir
 * bundleId/package resolvidos (útil quando app.config.js decide por
 * variante/APP_VARIANT, como no ONL).
 */
export function resolveExpoConfig(
	ctx: ReleaseKitContext,
	env: Record<string, string> = {}
): ExpoResolvedConfig {
	const result = ctx.run('npx', ['expo', 'config', '--json'], {
		cwd: ctx.appDir,
		env: { ...ctx.env, ...env },
		inherit: false,
	})
	if (result.status !== 0) {
		fail(`expo config --json falhou.\n${result.stderr || result.stdout}`)
	}
	try {
		return JSON.parse(result.stdout) as ExpoResolvedConfig
	} catch (error) {
		fail(`expo config --json não devolveu JSON válido: ${(error as Error).message}`)
	}
}
