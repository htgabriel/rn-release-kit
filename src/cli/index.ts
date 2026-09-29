#!/usr/bin/env node
import { parseCliArgs } from './parse.js'
import { runInitWizard } from './init.js'
import { runCredentialsCommand, type CredentialsScope } from './credentials.js'
import { runInteractiveMenu } from './menu.js'
import { runCiInitCommand } from './ci.js'
import {
	runBuildCommand,
	runDoctorCommand,
	runNotesCommand,
	runPromoteCommand,
	runRolloutCommand,
	runShipCommand,
	runStatusCommand,
	runSubmitCommand,
	runUpdateCommand,
	runVersionCommand,
} from './commands.js'
import { ReleaseKitError } from '../exec/run.js'

const HELP = `release-kit — orquestração de release para apps Expo/EAS

Uso:
  release-kit                              menu interativo (só com TTY)
  release-kit init                         wizard de setup (credenciais, canais, config)
  release-kit credentials [expo|apple|google|sync]
  release-kit doctor [--channel] [--platform] [--deep]
  release-kit version <patch|minor|major|x.y.z> [--push]
  release-kit notes [--version] [--edit]
  release-kit build --channel <c> --platform <android|ios> [--cloud]
  release-kit submit --channel <c> [--latest|--path <arquivo>]
  release-kit ship --channel <c> --platform <android|ios>
  release-kit promote --channel <c> [--platform]
  release-kit rollout --channel <c> --platform android --to <0-1|complete|halt>
  release-kit status --channel <c>
  release-kit update --channel <c> [--message]
  release-kit ci init github

Canais com "protected: true" (produção) exigem --i-know-this-is-production
(não-interativo) ou --confirm-version <versão exata>. Sem isso, nenhum
comando toca um canal protegido.

Flags globais: --dry-run --json --verbose --non-interactive
`

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const { command, positionals, flags } = parseCliArgs(argv)

	if (flags.help && command) {
		console.log(HELP)
		return
	}

	if (!command) {
		if (flags.help) {
			console.log(HELP)
			return
		}
		if (process.stdin.isTTY && !flags.nonInteractive) {
			await runInteractiveMenu()
			return
		}
		console.log(HELP)
		return
	}

	let result: unknown
	switch (command) {
		case 'init':
			await runInitWizard()
			return
		case 'credentials':
			await runCredentialsCommand(positionals[0] as CredentialsScope | undefined)
			return
		case 'ci':
			if (positionals[0] !== 'init') throw new ReleaseKitError('uso: release-kit ci init github')
			await runCiInitCommand(positionals[1])
			return
		case 'doctor':
			result = runDoctorCommand(flags)
			break
		case 'version': {
			const bump = positionals[0]
			if (!bump) throw new ReleaseKitError('uso: release-kit version <patch|minor|major|x.y.z>')
			result = runVersionCommand(flags, bump)
			break
		}
		case 'notes':
			result = runNotesCommand(flags)
			break
		case 'build':
			result = runBuildCommand(flags)
			break
		case 'submit':
			result = runSubmitCommand(flags)
			break
		case 'ship':
			result = runShipCommand(flags)
			break
		case 'promote':
			result = await runPromoteCommand(flags)
			break
		case 'rollout':
			result = await runRolloutCommand(flags)
			break
		case 'status':
			result = await runStatusCommand(flags)
			break
		case 'update':
			result = runUpdateCommand(flags)
			break
		default:
			throw new ReleaseKitError(`comando desconhecido: ${command}. Rode \`release-kit --help\`.`)
	}

	if (flags.json && result !== undefined) {
		console.log(JSON.stringify(result, null, 2))
	}
}

const invokedDirectly = process.argv[1]?.endsWith('cli/index.js') || process.argv[1]?.endsWith('release-kit')
if (invokedDirectly) {
	main().catch((error) => {
		if (error instanceof ReleaseKitError) {
			console.error(error.message)
			process.exit(error.code)
		}
		console.error(error)
		process.exit(1)
	})
}
