import type { ReleaseKitContext } from '../context.js'
import type { ReleaseKitConfig } from '../config/schema.js'
import { channelOf } from '../config/schema.js'
import { fail } from '../exec/run.js'
import { requireDoctorPass, runDoctor } from '../doctor/run.js'
import { buildRelease, type BuildOptions } from './build.js'
import { submitRelease, type SubmitResult } from './submit.js'

export interface ShipOptions extends BuildOptions {
	skipDoctor?: boolean
	allowToolchainDrift?: boolean
}

export interface ShipResult {
	dryRun?: boolean
	artifactPath?: string
	submit?: SubmitResult
}

export function shipRelease(ctx: ReleaseKitContext, config: ReleaseKitConfig, opts: ShipOptions): ShipResult {
	const channel = channelOf(config, opts.channel)
	if (!channel.store) {
		fail(`canal "${opts.channel}" não envia à loja (store: false). Use \`release-kit build\` direto para gerar o artefato de sideload.`)
	}

	let toolchainDrift = opts.toolchainDrift
	if (!opts.skipDoctor) {
		const report = runDoctor(ctx, config, {
			channel: opts.channel,
			platform: opts.platform,
			allowToolchainDrift: opts.allowToolchainDrift,
		})
		requireDoctorPass(report)
		toolchainDrift = report.toolchainDrift
	}

	const built = buildRelease(ctx, config, { ...opts, toolchainDrift })
	if (ctx.dryRun) return { dryRun: true, artifactPath: built.artifactPath }

	const submitted = submitRelease(ctx, config, {
		channel: opts.channel,
		platform: opts.platform,
		latest: true,
		iKnowThisIsProduction: opts.iKnowThisIsProduction,
		confirmVersion: opts.confirmVersion,
	})
	return { artifactPath: built.artifactPath, submit: submitted }
}
