import type { ParsedFlags } from './parse.js'
import { loadContextAndConfig } from './resolve.js'
import { printDoctorReport, requireDoctorPass, runDoctor } from '../doctor/run.js'
import { bumpVersion } from '../release/version.js'
import { draftAndEditNotes } from '../release/notes.js'
import { buildRelease } from '../release/build.js'
import { submitRelease } from '../release/submit.js'
import { shipRelease } from '../release/ship.js'
import { promoteRelease } from '../release/promote.js'
import { rolloutRelease, type RolloutOptions } from '../release/rollout.js'
import { printStatus, statusOf } from '../release/status.js'
import { updateRelease } from '../release/update.js'
import { fail } from '../exec/run.js'
import type { Platform } from '../config/schema.js'

function requirePlatform(flags: ParsedFlags): Platform {
	if (flags.platform !== 'android' && flags.platform !== 'ios') {
		fail('--platform é obrigatório (android|ios).')
	}
	return flags.platform
}

function requireChannel(flags: ParsedFlags): string {
	if (!flags.channel) fail('--channel é obrigatório.')
	return flags.channel!
}

export function runDoctorCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	const report = runDoctor(ctx, config, {
		channel: flags.channel,
		platform: flags.platform,
		deep: flags.deep,
		buildId: flags.buildId,
		allowToolchainDrift: flags.allowToolchainDrift,
	})
	if (!ctx.json) printDoctorReport(report, ctx)
	if (!flags.dryRun) requireDoctorPass(report)
	return report
}

export function runVersionCommand(flags: ParsedFlags, bump: string) {
	const { ctx, config } = loadContextAndConfig(flags)
	return bumpVersion(ctx, config, { bump, push: flags.push })
}

export function runNotesCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	return draftAndEditNotes(ctx, config, { version: flags.version, edit: flags.edit, skipEditor: flags.skipEditor })
}

export function runBuildCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	const channel = requireChannel(flags)
	const platform = requirePlatform(flags)
	return buildRelease(ctx, config, {
		channel,
		platform,
		cloud: flags.cloud,
		output: flags.output,
		iKnowThisIsProduction: flags.iKnowThisIsProduction,
		confirmVersion: flags.confirmVersion,
	})
}

export function runSubmitCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	const channel = requireChannel(flags)
	if (!flags.latest && !flags.path) fail('`submit` exige --latest ou --path <aab|ipa>.')
	return submitRelease(ctx, config, {
		channel,
		platform: flags.platform,
		latest: flags.latest,
		path: flags.path,
		iKnowThisIsProduction: flags.iKnowThisIsProduction,
		confirmVersion: flags.confirmVersion,
	})
}

export function runShipCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	const channel = requireChannel(flags)
	const platform = requirePlatform(flags)
	return shipRelease(ctx, config, {
		channel,
		platform,
		cloud: flags.cloud,
		output: flags.output,
		skipDoctor: flags.skipDoctor,
		allowToolchainDrift: flags.allowToolchainDrift,
		iKnowThisIsProduction: flags.iKnowThisIsProduction,
		confirmVersion: flags.confirmVersion,
	})
}

export function runPromoteCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	const channel = requireChannel(flags)
	return promoteRelease(ctx, config, {
		channel,
		platform: flags.platform,
		iKnowThisIsProduction: flags.iKnowThisIsProduction,
		confirmVersion: flags.confirmVersion,
	})
}

export function runRolloutCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	const channel = requireChannel(flags)
	const platform = requirePlatform(flags)
	if (!flags.to) fail('`rollout` exige --to <0-1|complete|halt>.')
	const to: RolloutOptions['to'] = flags.to === 'complete' || flags.to === 'halt' ? flags.to : Number(flags.to)
	return rolloutRelease(ctx, config, {
		channel,
		platform,
		to,
		iKnowThisIsProduction: flags.iKnowThisIsProduction,
		confirmVersion: flags.confirmVersion,
	})
}

export async function runStatusCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	const channel = requireChannel(flags)
	const status = await statusOf(ctx, config, { channel })
	if (!ctx.json) printStatus(ctx, status)
	return status
}

export function runUpdateCommand(flags: ParsedFlags) {
	const { ctx, config } = loadContextAndConfig(flags)
	const channel = requireChannel(flags)
	return updateRelease(ctx, config, {
		channel,
		message: flags.message,
		platform: flags.platform ?? 'all',
		iKnowThisIsProduction: flags.iKnowThisIsProduction,
		confirmVersion: flags.confirmVersion,
	})
}
