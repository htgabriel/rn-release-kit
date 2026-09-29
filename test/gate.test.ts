import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config/schema.js'
import { assertChannelOptIn } from '../src/release/gate.js'
import { createTmpRepo, type TmpRepo } from './helpers/tmp-repo.js'
import { afterEach } from 'vitest'

let repo: TmpRepo | undefined
afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

function config() {
	return parseConfig({
		platforms: ['android'],
		channels: {
			release: { buildProfile: 'release' },
			production: { protected: true, buildProfile: 'production' },
		},
	})
}

describe('assertChannelOptIn', () => {
	it('não bloqueia canal não-protegido', () => {
		repo = createTmpRepo()
		const cfg = config()
		expect(() => assertChannelOptIn(repo!.ctx, cfg, cfg.channels.release!, {})).not.toThrow()
	})

	it('bloqueia canal protegido sem flags', () => {
		repo = createTmpRepo()
		const cfg = config()
		expect(() => assertChannelOptIn(repo!.ctx, cfg, cfg.channels.production!, {})).toThrow(/canal protegido/)
	})

	it('libera com --i-know-this-is-production', () => {
		repo = createTmpRepo()
		const cfg = config()
		expect(() =>
			assertChannelOptIn(repo!.ctx, cfg, cfg.channels.production!, { iKnowThisIsProduction: true })
		).not.toThrow()
	})

	it('libera confirmando a versão exata', () => {
		repo = createTmpRepo()
		const cfg = config()
		expect(() => assertChannelOptIn(repo!.ctx, cfg, cfg.channels.production!, { confirmVersion: '1.0.0' })).not.toThrow()
	})

	it('rejeita confirmação com versão errada', () => {
		repo = createTmpRepo()
		const cfg = config()
		expect(() => assertChannelOptIn(repo!.ctx, cfg, cfg.channels.production!, { confirmVersion: '9.9.9' })).toThrow()
	})
})
