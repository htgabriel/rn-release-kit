import pc from 'picocolors'

export type LogFn = (message: string) => void

export interface Logger {
	info: LogFn
	warn: LogFn
	error: LogFn
	success: LogFn
	step: LogFn
	debug: LogFn
}

export interface CreateLoggerOptions {
	json?: boolean
	verbose?: boolean
	write?: (line: string) => void
}

/**
 * Todo output de log vai para stderr (console.error) — stdout fica livre
 * para `--json`, que imprime só o resultado estruturado do comando.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
	const write = options.write ?? ((line: string) => console.error(line))
	const silent = Boolean(options.json)

	const emit = (line: string) => {
		if (silent) return
		write(line)
	}

	return {
		info: (message) => emit(message),
		warn: (message) => emit(pc.yellow(`! ${message}`)),
		error: (message) => emit(pc.red(`✗ ${message}`)),
		success: (message) => emit(pc.green(`✓ ${message}`)),
		step: (message) => emit(pc.cyan(`→ ${message}`)),
		debug: (message) => {
			if (!options.verbose) return
			emit(pc.dim(message))
		},
	}
}
