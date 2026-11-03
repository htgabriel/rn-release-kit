import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseConfig } from '../src/config/schema.js'
import { easEnvListHasKey, easSubmit } from '../src/eas/cli.js'
import type { RunResult } from '../src/exec/run.js'
import { submitRelease } from '../src/release/submit.js'
import { createTmpRepo, type TmpRepo } from './helpers/tmp-repo.js'

let repo: TmpRepo | undefined
afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

function ctxWithEasOutput(stdout: string, status = 0) {
	repo = createTmpRepo()
	const run = vi.fn((): RunResult => ({ status, signal: null, stdout, stderr: '' }))
	return { ctx: { ...repo.ctx, run }, run }
}

describe('easEnvListHasKey', () => {
	it.each([
		['NOME=*** (saída real do env:list)', 'OUTRA=1\nSENTRY_AUTH_TOKEN=***\nMAIS=2\n'],
		['NOME=valor na última linha', 'SENTRY_AUTH_TOKEN=abc'],
		['somente o nome', 'SENTRY_AUTH_TOKEN\n'],
		['fim de linha CRLF', 'OUTRA=1\r\nSENTRY_AUTH_TOKEN=***\r\n'],
	])('encontra a variável: %s', (_label, stdout) => {
		const { ctx } = ctxWithEasOutput(stdout)
		expect(easEnvListHasKey(ctx, 'production', 'SENTRY_AUTH_TOKEN')).toBe(true)
	})

	it.each([
		['variável ausente', 'OUTRA=1\n'],
		['nome que apenas começa igual', 'SENTRY_AUTH_TOKEN_OLD=***\n'],
		['nome que apenas termina igual', 'MY_SENTRY_AUTH_TOKEN=***\n'],
		['nome presente só no valor de outra', 'OUTRA=SENTRY_AUTH_TOKEN\n'],
	])('não acusa falso positivo: %s', (_label, stdout) => {
		const { ctx } = ctxWithEasOutput(stdout)
		expect(easEnvListHasKey(ctx, 'production', 'SENTRY_AUTH_TOKEN')).toBe(false)
	})

	it('retorna false quando o eas env:list falha', () => {
		const { ctx } = ctxWithEasOutput('SENTRY_AUTH_TOKEN=***\n', 1)
		expect(easEnvListHasKey(ctx, 'production', 'SENTRY_AUTH_TOKEN')).toBe(false)
	})
})

describe('eas submit --non-interactive', () => {
	it('a execução real repassa a flag', () => {
		const { ctx, run } = ctxWithEasOutput('')
		easSubmit(ctx, { platform: 'android', submitProfile: 'release', path: '/tmp/app.aab', env: {} })
		expect(run).toHaveBeenCalledWith('eas', expect.arrayContaining(['submit', '--non-interactive']), expect.anything())
	})

	it('o comando impresso no dry-run é o mesmo da execução real', () => {
		repo = createTmpRepo()
		const artifact = join(repo.dir, 'app.aab')
		writeFileSync(artifact, '')
		const config = parseConfig({ platforms: ['android'], channels: { release: { buildProfile: 'release' } } })

		const result = submitRelease({ ...repo.ctx, dryRun: true }, config, { channel: 'release', path: artifact })

		expect(result.command).toContain('--non-interactive')
	})
})
