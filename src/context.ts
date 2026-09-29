import { defaultRun, type Runner } from './exec/run.js'
import { createLogger, type Logger } from './ui/log.js'

export interface ReleaseKitContext {
	/** Raiz do repositório git do projeto consumidor. */
	repoRoot: string
	/** Diretório do app Expo (".", "packages/app", etc). */
	appDir: string
	/** Onde ficam os artefatos e metadata de build (gitignored). */
	releaseDir: string
	env: NodeJS.ProcessEnv
	dryRun: boolean
	json: boolean
	verbose: boolean
	/** Sem TTY / --non-interactive: nunca pergunta, nunca publica sem flags explícitas. */
	nonInteractive: boolean
	run: Runner
	log: Logger
	/** Usado no gate de canal protegido: pede para digitar a versão exata. */
	confirm?: (question: string) => Promise<string> | string
}

export interface CreateContextOverrides {
	repoRoot: string
	appDir?: string
	releaseDir?: string
	env?: NodeJS.ProcessEnv
	dryRun?: boolean
	json?: boolean
	verbose?: boolean
	nonInteractive?: boolean
	run?: Runner
	log?: Logger
	confirm?: (question: string) => Promise<string> | string
}

export function createContext(overrides: CreateContextOverrides): ReleaseKitContext {
	const env = overrides.env ?? process.env
	const json = Boolean(overrides.json)
	return {
		repoRoot: overrides.repoRoot,
		appDir: overrides.appDir ?? overrides.repoRoot,
		releaseDir: overrides.releaseDir ?? `${overrides.repoRoot}/.release`,
		env,
		dryRun: Boolean(overrides.dryRun),
		json,
		verbose: Boolean(overrides.verbose),
		nonInteractive: overrides.nonInteractive ?? !process.stdin.isTTY,
		run: overrides.run ?? defaultRun,
		log: overrides.log ?? createLogger({ json, verbose: overrides.verbose }),
		confirm: overrides.confirm,
	}
}

export type { Runner } from './exec/run.js'
export type { Logger } from './ui/log.js'
