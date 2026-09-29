import type { ReleaseKitContext } from '../context.js'
import { fail, formatCommand, requireSuccess } from '../exec/run.js'
import type { Platform, ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { easUpdate } from '../eas/cli.js'
import { assertChannelOptIn, type ProtectedGateOptions } from './gate.js'

export interface UpdateOptions extends ProtectedGateOptions {
	channel: string
	message?: string
	platform?: Platform | 'all'
}

export interface UpdateResult {
	dryRun?: boolean
	command?: string
	channel: string
}

/**
 * OTA via `eas update`. Canal protegido passa pelo mesmo gate fail-closed
 * do build/submit: só roda com --i-know-this-is-production ou confirmando
 * a versão — nunca por padrão, mesmo em `release-kit update` sem flags.
 */
export function updateRelease(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: UpdateOptions): UpdateResult {
	const channel = channelOf(config, opts.channel)
	assertChannelOptIn(ctx, config, channel, opts)
	if (!channel.ota) {
		fail(`canal "${opts.channel}" não tem "ota.channel" configurado.`)
	}

	if (ctx.dryRun) {
		const command = formatCommand('eas', ['update', '--channel', channel.ota.channel, '--message', opts.message ?? '(sem mensagem)'], channel.env)
		ctx.log.info(`[dry-run] cd ${ctx.appDir} && ${command}`)
		return { dryRun: true, command, channel: channel.ota.channel }
	}

	ctx.log.step(`eas update (channel ${channel.ota.channel})`)
	requireSuccess(
		easUpdate(ctx, { channel: channel.ota.channel, message: opts.message, platform: opts.platform, env: channel.env }),
		'eas update'
	)
	return { channel: channel.ota.channel }
}
