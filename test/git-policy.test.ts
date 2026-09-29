import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkGitPolicy, currentBranch } from '../src/git/policy.js'
import { parseConfig } from '../src/config/schema.js'
import { createTmpRepo, type TmpRepo } from './helpers/tmp-repo.js'

let repo: TmpRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

function gitPolicy() {
	return parseConfig({
		platforms: ['android'],
		channels: { release: { buildProfile: 'release' } },
	}).git
}

describe('checkGitPolicy', () => {
	it('passa git-clean e git-sync-skip quando não há upstream configurado (canal não protegido)', () => {
		repo = createTmpRepo()
		const checks = checkGitPolicy(repo.ctx, gitPolicy(), { version: '1.0.0', isProtectedChannel: false })
		const clean = checks.find((c) => c.name === 'git-clean')
		expect(clean?.status).toBe('pass')
		const sync = checks.find((c) => c.name === 'git-sync')
		expect(sync?.status).toBe('fail') // sem upstream
	})

	it('reporta working tree suja', () => {
		repo = createTmpRepo()
		writeFileSync(join(repo.dir, 'app.json'), JSON.stringify({ expo: { version: '1.0.1' } }))
		const checks = checkGitPolicy(repo.ctx, gitPolicy(), { version: '1.0.0', isProtectedChannel: false })
		const clean = checks.find((c) => c.name === 'git-clean')
		expect(clean?.status).toBe('fail')
	})

	it('canal protegido exige branch de release e tag == HEAD', () => {
		repo = createTmpRepo()
		const checks = checkGitPolicy(repo.ctx, gitPolicy(), { version: '1.0.0', isProtectedChannel: true })
		const branch = checks.find((c) => c.name === 'git-branch')
		expect(branch?.status).toBe('pass') // já está em "main"
		const tag = checks.find((c) => c.name === 'git-tag')
		expect(tag?.status).toBe('fail') // tag v1.0.0 não existe ainda
	})

	it('canal protegido passa git-tag quando a tag existe e aponta pro HEAD', () => {
		repo = createTmpRepo()
		repo.git(['tag', 'v1.0.0'])
		const checks = checkGitPolicy(repo.ctx, gitPolicy(), { version: '1.0.0', isProtectedChannel: true })
		const tag = checks.find((c) => c.name === 'git-tag')
		expect(tag?.status).toBe('pass')
	})

	it('branch atual é detectada corretamente', () => {
		repo = createTmpRepo()
		expect(currentBranch(repo.ctx)).toBe('main')
	})

	it('canal protegido em branch errada falha', () => {
		repo = createTmpRepo()
		repo.git(['checkout', '-q', '-b', 'feature/x'])
		const checks = checkGitPolicy(repo.ctx, gitPolicy(), { version: '1.0.0', isProtectedChannel: true })
		const branch = checks.find((c) => c.name === 'git-branch')
		expect(branch?.status).toBe('fail')
	})
})
