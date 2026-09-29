import type { ReleaseKitContext } from '../context.js'
import { fail } from '../exec/run.js'
import type { ChannelConfig, ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { readAppVersion } from '../project/version.js'

export interface ProtectedGateOptions {
	iKnowThisIsProduction?: boolean
	confirmVersion?: string
}

/**
 * Gate fail-closed para canais `protected: true`: exige
 * `--i-know-this-is-production` (não-interativo) ou confirmação digitando a
 * versão exata. Sem isso, nenhum comando toca um canal protegido — nem
 * build, nem submit, nem update OTA.
 */
export function assertChannelOptIn(
	ctx: ReleaseKitContext,
	config: ReleaseKitConfig,
	channel: ChannelConfig,
	opts: ProtectedGateOptions
): void {
	if (!channel.protected) return
	if (opts.iKnowThisIsProduction) return
	const version = readAppVersion(ctx.appDir, config)
	if (opts.confirmVersion && opts.confirmVersion.trim() === version) return
	fail(
		`canal protegido: passe --i-know-this-is-production (não-interativo) ou confirme digitando a versão exata (${version}). \`release-kit\` sem argumentos nunca resolve para um canal protegido.`
	)
}

/**
 * No menu interativo/TTY, pede para digitar a versão em vez de exigir a
 * flag. Não é chamado em modo não-interativo — lá o gate só aceita a flag.
 */
export async function confirmProtectedChannelVersion(
	ctx: ReleaseKitContext,
	config: ReleaseKitConfig,
	channelName: string
): Promise<string> {
	const channel = channelOf(config, channelName)
	if (!channel.protected) return ''
	const version = readAppVersion(ctx.appDir, config)
	if (!ctx.confirm) return ''
	ctx.log.warn(`canal "${channelName}" é protegido — gera binário/OTA de produção.`)
	const answer = await ctx.confirm(`Digite a versão exatamente (${version}) para continuar: `)
	return String(answer || '').trim()
}
