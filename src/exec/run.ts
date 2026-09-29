import crossSpawn from 'cross-spawn'

export class ReleaseKitError extends Error {
	code: number

	constructor(message: string, { code = 1 }: { code?: number } = {}) {
		super(message)
		this.name = 'ReleaseKitError'
		this.code = code
	}
}

export function fail(message: string, code = 1): never {
	throw new ReleaseKitError(message, { code })
}

export interface RunResult {
	status: number
	signal: NodeJS.Signals | null
	stdout: string
	stderr: string
	error?: Error
	dryRun?: boolean
	printed?: string
}

export interface RunOptions {
	cwd?: string
	env?: NodeJS.ProcessEnv
	inherit?: boolean
	dryRun?: boolean
}

/**
 * Só as env vars relevantes (APP_VARIANT, EAS_*) aparecem no comando
 * impresso — nunca segredos herdados do processo.
 */
export function formatCommand(
	command: string,
	args: string[],
	env: Record<string, string | undefined> = {}
): string {
	const exported = Object.entries(env)
		.filter(([key, value]) => value !== undefined && (key === 'APP_VARIANT' || key.startsWith('EAS_')))
		.map(([key, value]) => `${key}=${value}`)
		.join(' ')
	const body = [command, ...args].join(' ')
	return exported ? `${exported} ${body}` : body
}

export type Runner = (command: string, args: string[], options?: RunOptions) => RunResult

/**
 * spawnSync via cross-spawn: no Windows resolve .cmd/.bat (eas -> eas.cmd,
 * yarn -> yarn.cmd) e escapa argumentos corretamente. Sem isso `eas build`
 * falha silenciosamente fora do macOS/Linux.
 */
export const defaultRun: Runner = (command, args, { cwd, env, inherit = false, dryRun = false } = {}) => {
	const extraEnv = env ?? {}
	if (dryRun) {
		return {
			status: 0,
			signal: null,
			stdout: '',
			stderr: '',
			dryRun: true,
			printed: formatCommand(command, args, extraEnv),
		}
	}
	const result = crossSpawn.sync(command, args, {
		cwd,
		env: { ...process.env, ...extraEnv },
		encoding: 'utf8',
		stdio: inherit ? 'inherit' : 'pipe',
		maxBuffer: 32 * 1024 * 1024,
	})
	return {
		status: result.status ?? 1,
		signal: result.signal ?? null,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		error: result.error,
	}
}

export function requireSuccess(result: RunResult, label: string): RunResult {
	if (result.dryRun) return result
	if (result.status === 0) return result
	const how = result.signal ? `sinal ${result.signal}` : `exit ${result.status}`
	const detail = (result.stderr || result.stdout || result.error?.message || '').trim()
	fail(`${label} falhou (${how}).${detail ? `\n${detail}` : ''}`)
}
