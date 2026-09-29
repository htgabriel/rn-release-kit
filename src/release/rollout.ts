import type { ReleaseKitContext } from '../context.js'
import type { Platform, ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { fail } from '../exec/run.js'
import { assertChannelOptIn, type ProtectedGateOptions } from './gate.js'
import { createGoogleClient } from '../stores/credentials.js'
import { setRollout, type RolloutTarget } from '../stores/google/tracks.js'

export interface RolloutOptions extends ProtectedGateOptions {
	channel: string
	platform: Platform
	to: RolloutTarget
}

/**
 * Só Android tem rollout percentual manipulável via API sem reupload
 * (`userFraction`). No iOS o equivalente é o phased release, controlado
 * pelo próprio App Store Connect após a review — não há endpoint de
 * pause/resume simples e estável na API pública hoje; documentado como
 * limitação em vez de fingir suporte.
 */
export async function rolloutRelease(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: RolloutOptions) {
	if (opts.platform !== 'android') {
		fail('rollout percentual só é suportado para Android nesta versão. iOS: acompanhe o phased release no App Store Connect.')
	}
	const channel = channelOf(config, opts.channel)
	assertChannelOptIn(ctx, config, channel, opts)
	if (!channel.android) fail(`canal "${opts.channel}" não tem configuração android.`)

	if (ctx.dryRun) {
		ctx.log.info(`[dry-run] Play: ${channel.android.productionTrack} → ${opts.to}`)
		return { dryRun: true }
	}

	const google = createGoogleClient(ctx.env)
	try {
		const release = await setRollout(google, channel.android.package, channel.android.productionTrack, opts.to)
		ctx.log.success(`Play: ${channel.android.productionTrack} agora ${release.status}${release.userFraction ? ` (${Math.round(release.userFraction * 100)}%)` : ''}`)
		return release
	} finally {
		google.cleanup()
	}
}
