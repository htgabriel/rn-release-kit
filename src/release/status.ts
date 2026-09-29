import type { ReleaseKitContext } from '../context.js'
import type { ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { readAppVersion } from '../project/version.js'
import { createAppleClient, createGoogleClient } from '../stores/credentials.js'
import { getTrackStatus } from '../stores/google/tracks.js'
import { getIosStatus } from '../stores/apple/review.js'

export interface StatusOptions {
	channel: string
}

export interface StatusResult {
	version: string
	android?: { track: string; releases: Array<{ status: string; versionCodes?: string[]; userFraction?: number }> }
	ios?: { appStoreState: string | null; reviewSubmissionState: string | null }
}

export async function statusOf(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: StatusOptions): Promise<StatusResult> {
	const channel = channelOf(config, opts.channel)
	const version = readAppVersion(ctx.appDir, config)
	const result: StatusResult = { version }

	if (channel.android) {
		const google = createGoogleClient(ctx.env)
		try {
			const track = await getTrackStatus(google, channel.android.package, channel.android.productionTrack)
			result.android = {
				track: channel.android.productionTrack,
				releases: (track.releases ?? []).map((release) => ({
					status: release.status,
					versionCodes: release.versionCodes,
					userFraction: release.userFraction,
				})),
			}
		} finally {
			google.cleanup()
		}
	}

	if (channel.ios) {
		const apple = createAppleClient(ctx.env)
		try {
			const status = await getIosStatus(apple, channel.ios.bundleId, version)
			result.ios = { appStoreState: status.appStoreState, reviewSubmissionState: status.reviewSubmissionState }
		} finally {
			apple.cleanup()
		}
	}

	return result
}

export function printStatus(ctx: ReleaseKitContext, status: StatusResult): void {
	ctx.log.info(`versão: ${status.version}`)
	if (status.android) {
		ctx.log.info(`Play (${status.android.track}):`)
		for (const release of status.android.releases) {
			const fraction = release.userFraction ? ` (${Math.round(release.userFraction * 100)}%)` : ''
			ctx.log.info(`  - ${release.status}${fraction} — versionCodes: ${(release.versionCodes ?? []).join(', ')}`)
		}
	}
	if (status.ios) {
		ctx.log.info(`App Store: appStoreState=${status.ios.appStoreState ?? '(sem versão editável)'} reviewSubmission=${status.ios.reviewSubmissionState ?? '(nenhuma em andamento)'}`)
	}
}
