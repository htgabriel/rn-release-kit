import * as p from '@clack/prompts'
import pc from 'picocolors'
import { loadContextAndConfig } from './resolve.js'
import { readAppVersion } from '../project/version.js'
import type { ParsedFlags } from './parse.js'
import {
	runBuildCommand,
	runDoctorCommand,
	runNotesCommand,
	runPromoteCommand,
	runShipCommand,
	runStatusCommand,
	runSubmitCommand,
	runUpdateCommand,
	runVersionCommand,
} from './commands.js'
import { channelOf } from '../config/schema.js'
import { confirmProtectedChannelVersion } from '../release/gate.js'

/**
 * `release-kit` sem argumentos: menu guiado. Só existe com TTY — em
 * CI/non-interactive cai no help e nunca publica nada (ver cli/index.ts).
 */
export async function runInteractiveMenu(): Promise<void> {
	p.intro(pc.bold('release-kit'))
	const { ctx, config } = loadContextAndConfig({})
	const version = readAppVersion(ctx.appDir, config)
	p.log.info(`versão atual: ${version} · canais: ${Object.keys(config.channels).join(', ')}`)

	const action = await p.select({
		message: 'O que você quer fazer?',
		options: [
			{ value: 'doctor', label: 'doctor — preflight' },
			{ value: 'version', label: 'version — bump + tag' },
			{ value: 'notes', label: 'notes — rascunhar/editar notas de versão' },
			{ value: 'build', label: 'build — gerar o binário' },
			{ value: 'submit', label: 'submit — enviar à faixa de teste' },
			{ value: 'ship', label: 'ship — doctor + build + submit' },
			{ value: 'status', label: 'status — ver review/rollout' },
			{ value: 'update', label: 'update — OTA' },
			{ value: 'promote', label: 'promote — produção (App Review / Play production)' },
			{ value: 'exit', label: 'saída' },
		],
	})
	if (p.isCancel(action) || action === 'exit') {
		p.outro('Nada feito.')
		return
	}

	const channelNames = Object.keys(config.channels)
	const channel = await p.select({
		message: 'Canal',
		options: channelNames.map((name) => ({ value: name, label: `${name}${config.channels[name]!.protected ? ' (protegido)' : ''}` })),
	})
	if (p.isCancel(channel)) return

	const flags: ParsedFlags = { channel }

	if (['build', 'submit', 'ship', 'update'].includes(action)) {
		if (config.platforms.length > 1) {
			const platform = await p.select({
				message: 'Plataforma',
				options: config.platforms.map((pl) => ({ value: pl, label: pl })),
			})
			if (p.isCancel(platform)) return
			flags.platform = platform
		} else {
			flags.platform = config.platforms[0]
		}
	}

	const selectedChannel = channelOf(config, channel)
	if (selectedChannel.protected) {
		const typed = await confirmProtectedChannelVersion(ctx, config, channel)
		flags.confirmVersion = typed
	}

	try {
		switch (action) {
			case 'doctor':
				runDoctorCommand(flags)
				break
			case 'version': {
				const bump = await p.select({ message: 'Bump', options: [{ value: 'patch', label: 'patch' }, { value: 'minor', label: 'minor' }, { value: 'major', label: 'major' }] })
				if (p.isCancel(bump)) return
				runVersionCommand(flags, bump)
				break
			}
			case 'notes':
				runNotesCommand(flags)
				break
			case 'build':
				runBuildCommand(flags)
				break
			case 'submit':
				runSubmitCommand({ ...flags, latest: true })
				break
			case 'ship':
				runShipCommand(flags)
				break
			case 'status':
				await runStatusCommand(flags)
				break
			case 'update':
				runUpdateCommand(flags)
				break
			case 'promote':
				await runPromoteCommand(flags)
				break
		}
		p.outro('Feito.')
	} catch (error) {
		p.log.error((error as Error).message)
		p.outro('Falhou.')
		process.exitCode = 1
	}
}
