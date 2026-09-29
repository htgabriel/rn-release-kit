import { parseArgs } from 'node:util'
import type { Platform } from '../config/schema.js'

export interface ParsedFlags {
	channel?: string
	platform?: Platform
	version?: string
	push?: boolean
	edit?: boolean
	skipEditor?: boolean
	cloud?: boolean
	output?: string
	latest?: boolean
	path?: string
	to?: string
	message?: string
	deep?: boolean
	buildId?: string
	skipDoctor?: boolean
	allowToolchainDrift?: boolean
	iKnowThisIsProduction?: boolean
	confirmVersion?: string
	dryRun?: boolean
	json?: boolean
	verbose?: boolean
	yes?: boolean
	nonInteractive?: boolean
	help?: boolean
}

export interface ParsedArgs {
	command: string | undefined
	positionals: string[]
	flags: ParsedFlags
}

export function parseCliArgs(argv: string[]): ParsedArgs {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		strict: true,
		options: {
			channel: { type: 'string' },
			platform: { type: 'string' },
			version: { type: 'string' },
			push: { type: 'boolean' },
			edit: { type: 'boolean' },
			'skip-editor': { type: 'boolean' },
			cloud: { type: 'boolean' },
			output: { type: 'string' },
			latest: { type: 'boolean' },
			path: { type: 'string' },
			to: { type: 'string' },
			message: { type: 'string' },
			deep: { type: 'boolean' },
			'build-id': { type: 'string' },
			'skip-doctor': { type: 'boolean' },
			'allow-toolchain-drift': { type: 'boolean' },
			'i-know-this-is-production': { type: 'boolean' },
			'confirm-version': { type: 'string' },
			'dry-run': { type: 'boolean' },
			json: { type: 'boolean' },
			verbose: { type: 'boolean' },
			yes: { type: 'boolean', short: 'y' },
			'non-interactive': { type: 'boolean' },
			help: { type: 'boolean', short: 'h' },
		},
	})

	const [command, ...rest] = positionals
	return {
		command,
		positionals: rest,
		flags: {
			channel: values.channel,
			platform: values.platform as Platform | undefined,
			version: values.version,
			push: values.push,
			edit: values.edit,
			skipEditor: values['skip-editor'],
			cloud: values.cloud,
			output: values.output,
			latest: values.latest,
			path: values.path,
			to: values.to,
			message: values.message,
			deep: values.deep,
			buildId: values['build-id'],
			skipDoctor: values['skip-doctor'],
			allowToolchainDrift: values['allow-toolchain-drift'],
			iKnowThisIsProduction: values['i-know-this-is-production'],
			confirmVersion: values['confirm-version'],
			dryRun: values['dry-run'],
			json: values.json,
			verbose: values.verbose,
			yes: values.yes,
			nonInteractive: values['non-interactive'],
			help: values.help,
		},
	}
}
