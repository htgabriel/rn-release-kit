import * as p from '@clack/prompts'
import pc from 'picocolors'
import { buildContext, withAppDir } from './resolve.js'
import { loadConfig, writeConfig } from '../config/load.js'
import { writeEnvFile } from '../env/store.js'
import { ensureEasLogin, runAppleCredentialsStep, runGoogleCredentialsStep } from './init.js'

export type CredentialsScope = 'expo' | 'apple' | 'google' | 'sync'

/** `release-kit credentials [expo|apple|google|sync]` — refaz uma etapa isolada do wizard. */
export async function runCredentialsCommand(scope: CredentialsScope | undefined): Promise<void> {
	p.intro(pc.bold(`release-kit credentials ${scope ?? ''}`))
	const base = buildContext({})
	const config = loadConfig(base.repoRoot)
	const ctx = withAppDir(base, config)
	const slug = ctx.repoRoot.split('/').filter(Boolean).pop() ?? 'release-kit-project'

	const envUpdates: Record<string, string> = {}

	if (!scope || scope === 'expo') {
		await ensureEasLogin(ctx)
	}
	if (!scope || scope === 'apple') {
		if (config.platforms.includes('ios')) await runAppleCredentialsStep(ctx, slug, config.channels, envUpdates)
		else p.log.warn('config.platforms não inclui ios — nada a validar.')
	}
	if (!scope || scope === 'google') {
		if (config.platforms.includes('android')) await runGoogleCredentialsStep(slug, config.channels, envUpdates)
		else p.log.warn('config.platforms não inclui android — nada a validar.')
	}
	if (scope === 'sync') {
		p.log.info('Rode `eas credentials` (ASC key / Play SA) e `eas env:create` para sincronizar com builds na nuvem.')
	}

	if (Object.keys(envUpdates).length > 0) {
		writeEnvFile(ctx.repoRoot, envUpdates)
		writeConfig(ctx.repoRoot, config)
		p.log.success('.env.release e release-kit.config.json atualizados.')
	}

	p.outro('Credenciais atualizadas.')
}
