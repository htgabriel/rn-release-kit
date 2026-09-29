import { describe, expect, it } from 'vitest'
import { channelOf, parseConfig, protectedChannelNames } from '../src/config/schema.js'

function baseConfig(overrides: Record<string, unknown> = {}) {
	return {
		platforms: ['android', 'ios'],
		channels: {
			release: { buildProfile: 'release', submitProfile: 'release' },
			production: { protected: true, buildProfile: 'production', submitProfile: 'local-validation' },
		},
		...overrides,
	}
}

describe('parseConfig', () => {
	it('aplica defaults (locales, git policy, doctor)', () => {
		const config = parseConfig(baseConfig())
		expect(config.locales).toEqual(['pt-BR'])
		expect(config.git.releaseBranch).toBe('main')
		expect(config.git.tagFormat).toBe('v{version}')
		expect(config.doctor.expoDoctor).toBe(true)
		expect(config.doctor.sentry).toBe(false)
	})

	it('exige ao menos uma plataforma', () => {
		expect(() => parseConfig(baseConfig({ platforms: [] }))).toThrow()
	})

	it('exige ao menos um canal', () => {
		expect(() => parseConfig(baseConfig({ channels: {} }))).toThrow()
	})

	it('marca canais protegidos corretamente', () => {
		const config = parseConfig(baseConfig())
		expect(protectedChannelNames(config)).toEqual(['production'])
		expect(channelOf(config, 'release').protected).toBe(false)
		expect(channelOf(config, 'production').protected).toBe(true)
	})

	it('canal desconhecido lança erro claro', () => {
		const config = parseConfig(baseConfig())
		expect(() => channelOf(config, 'nope')).toThrow(/canal desconhecido/)
	})

	it('autoIncrement e sentryUploadDisabled têm default sensato', () => {
		const config = parseConfig(baseConfig())
		expect(channelOf(config, 'release').autoIncrement).toBe(true)
		expect(channelOf(config, 'release').sentryUploadDisabled).toBe(false)
	})
})
