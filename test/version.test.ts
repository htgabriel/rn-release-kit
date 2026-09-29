import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config/schema.js'
import { nextVersion, readAppVersion, writeAppVersion } from '../src/project/version.js'

describe('nextVersion', () => {
	it('incrementa patch/minor/major', () => {
		expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4')
		expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
		expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
	})

	it('aceita uma versão explícita maior que a atual', () => {
		expect(nextVersion('1.2.3', '1.5.0')).toBe('1.5.0')
	})

	it('rejeita versão explícita menor ou igual', () => {
		expect(() => nextVersion('1.2.3', '1.2.3')).toThrow()
		expect(() => nextVersion('1.2.3', '1.0.0')).toThrow()
	})

	it('rejeita string inválida', () => {
		expect(() => nextVersion('1.2.3', 'not-a-version')).toThrow()
	})
})

describe('readAppVersion / writeAppVersion', () => {
	let dir: string
	afterEach(() => rmSync(dir, { recursive: true, force: true }))

	it('lê e escreve a versão em app.json', () => {
		dir = mkdtempSync(join(tmpdir(), 'release-kit-version-'))
		writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { name: 'App', version: '1.0.0' } }))
		const config = parseConfig({ platforms: ['android'], channels: { release: { buildProfile: 'release' } } })

		expect(readAppVersion(dir, config)).toBe('1.0.0')
		writeAppVersion(dir, config, '1.1.0')
		expect(readAppVersion(dir, config)).toBe('1.1.0')
	})

	it('lê e escreve a versão em package.json quando configurado', () => {
		dir = mkdtempSync(join(tmpdir(), 'release-kit-version-'))
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', version: '2.0.0' }))
		const config = parseConfig({
			platforms: ['android'],
			channels: { release: { buildProfile: 'release' } },
			version: { source: 'package.json' },
		})
		expect(readAppVersion(dir, config)).toBe('2.0.0')
		writeAppVersion(dir, config, '2.1.0')
		expect(readAppVersion(dir, config)).toBe('2.1.0')
	})
})
