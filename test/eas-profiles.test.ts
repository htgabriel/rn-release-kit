import { describe, expect, it } from 'vitest'
import { androidBuildTypeExt, resolveBuildProfileChain } from '../src/eas/profiles.js'

const easJson = {
	build: {
		base: { android: { buildType: 'app-bundle' } },
		release: { extends: 'base', environment: 'preview' },
		'release-local': { extends: 'release', android: { buildType: 'apk' } },
	},
}

describe('resolveBuildProfileChain', () => {
	it('herda campos do profile base', () => {
		const resolved = resolveBuildProfileChain(easJson, 'release')
		expect(resolved.android?.buildType).toBe('app-bundle')
		expect(resolved.environment).toBe('preview')
	})

	it('o filho sobrescreve o pai', () => {
		const resolved = resolveBuildProfileChain(easJson, 'release-local')
		expect(resolved.android?.buildType).toBe('apk')
	})

	it('lança erro para profile inexistente', () => {
		expect(() => resolveBuildProfileChain(easJson, 'nope')).toThrow()
	})
})

describe('androidBuildTypeExt', () => {
	it('aab por padrão', () => {
		expect(androidBuildTypeExt(easJson, 'release')).toBe('aab')
	})

	it('apk quando o profile (ou o herdado) diz apk', () => {
		expect(androidBuildTypeExt(easJson, 'release-local')).toBe('apk')
	})
})
