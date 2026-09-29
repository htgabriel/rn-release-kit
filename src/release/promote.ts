import type { ReleaseKitContext } from '../context.js'
import type { Platform, ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { fail } from '../exec/run.js'
import { readAppVersion } from '../project/version.js'
import { notesFilePath, readNotesFile } from '../notes/paths.js'
import { assertChannelOptIn, type ProtectedGateOptions } from './gate.js'
import { createAppleClient, createGoogleClient } from '../stores/credentials.js'
import { promoteRelease as promotePlayRelease } from '../stores/google/tracks.js'
import { submitForReview } from '../stores/apple/review.js'

export interface PromoteOptions extends ProtectedGateOptions {
	channel: string
	platform?: Platform
}

export interface PromoteResult {
	android?: { versionCodes?: string[]; status: string }
	ios?: { submissionId: string; state: string; alreadyInProgress: boolean }
}

function notesByLocale(ctx: ReleaseKitContext, config: ReleaseKitConfig, version: string, target: 'ios' | 'play'): Record<string, string> {
	const result: Record<string, string> = {}
	for (const locale of config.locales) {
		const path = notesFilePath(ctx.appDir, config.notesDir, version, locale, target)
		result[locale] = readNotesFile(path)
	}
	return result
}

/**
 * `build` + `submit` já colocaram o binário na faixa de teste
 * (Play Internal / TestFlight). `promote` não faz upload nenhum: copia a
 * release pra faixa de produção (Play) ou cria a Review Submission
 * (Apple) — é o equivalente ao `local-validation` → produção do kit
 * original.
 */
export async function promoteRelease(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: PromoteOptions): Promise<PromoteResult> {
	const channel = channelOf(config, opts.channel)
	assertChannelOptIn(ctx, config, channel, opts)
	const version = readAppVersion(ctx.appDir, config)
	const result: PromoteResult = {}

	const wantsAndroid = (!opts.platform || opts.platform === 'android') && channel.android
	const wantsIos = (!opts.platform || opts.platform === 'ios') && channel.ios

	if (!wantsAndroid && !wantsIos) fail('nenhuma plataforma configurada no canal para promover.')

	if (ctx.dryRun) {
		if (wantsAndroid) ctx.log.info(`[dry-run] Play: promover ${channel.android!.testTrack} → ${channel.android!.productionTrack} (${channel.android!.package})`)
		if (wantsIos) ctx.log.info(`[dry-run] Apple: criar Review Submission para ${channel.ios!.bundleId} v${version}`)
		return result
	}

	if (wantsAndroid) {
		const android = channel.android!
		const google = createGoogleClient(ctx.env)
		try {
			const notes = notesByLocale(ctx, config, version, 'play')
			ctx.log.step(`Play: promovendo ${android.testTrack} → ${android.productionTrack}`)
			const release = await promotePlayRelease(google, {
				packageName: android.package,
				fromTrack: android.testTrack,
				toTrack: android.productionTrack,
				notesByLocale: notes,
				initialRollout: android.initialRollout,
			})
			ctx.log.success(`Play: ${android.productionTrack} status=${release.status} versionCodes=${(release.versionCodes ?? []).join(',')}`)
			result.android = { versionCodes: release.versionCodes, status: release.status }
		} finally {
			google.cleanup()
		}
	}

	if (wantsIos) {
		const ios = channel.ios!
		const apple = createAppleClient(ctx.env)
		try {
			const notes = notesByLocale(ctx, config, version, 'ios')
			ctx.log.step(`Apple: enviando Review Submission para ${ios.bundleId} v${version}`)
			const submission = await submitForReview(apple, {
				bundleId: ios.bundleId,
				versionString: version,
				whatsNewByLocale: notes,
				automaticRelease: ios.automaticRelease,
				phasedRelease: ios.phasedRelease,
				copyright: ios.copyright,
			})
			if (submission.alreadyInProgress) {
				ctx.log.warn(`Apple: já existe submission em análise (${submission.submissionId}, state=${submission.state}).`)
			} else {
				ctx.log.success(`Apple: submission ${submission.submissionId} enviada (state=${submission.state}).`)
			}
			result.ios = { submissionId: submission.submissionId, state: submission.state, alreadyInProgress: submission.alreadyInProgress }
		} finally {
			apple.cleanup()
		}
	}

	return result
}
