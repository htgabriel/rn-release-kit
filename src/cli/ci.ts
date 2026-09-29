import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { buildContext } from './resolve.js'
import { loadConfig } from '../config/load.js'

const WORKFLOW_TEMPLATE = `name: Release kit

on:
  workflow_dispatch:
    inputs:
      channel:
        description: "Canal (ver release-kit.config.json)"
        required: true
        default: "release"
      platform:
        description: "android | ios"
        required: true
        default: "android"

jobs:
  ship:
    name: doctor + build (cloud) + submit (faixa de teste)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g eas-cli @htgabriel/release-kit
      - name: doctor
        run: release-kit doctor --channel \${{ inputs.channel }} --platform \${{ inputs.platform }} --json
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
      - name: ship (build cloud + submit)
        run: release-kit ship --channel \${{ inputs.channel }} --platform \${{ inputs.platform }} --cloud --json
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
          ASC_KEY_ID: \${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: \${{ secrets.ASC_ISSUER_ID }}
          ASC_KEY_P8_CONTENT: \${{ secrets.ASC_KEY_P8_CONTENT }}
          GOOGLE_PLAY_JSON_CONTENT: \${{ secrets.GOOGLE_PLAY_JSON_CONTENT }}

  # Canal protegido nunca roda automático — precisa de workflow_dispatch
  # manual + Environment com reviewers no repositório (Settings → Environments).
  promote:
    name: promote (produção — requer approval do Environment)
    runs-on: ubuntu-latest
    environment: production
    if: inputs.channel == 'production'
    needs: [ship]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g eas-cli @htgabriel/release-kit
      - run: release-kit promote --channel \${{ inputs.channel }} --i-know-this-is-production --json
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
          ASC_KEY_ID: \${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: \${{ secrets.ASC_ISSUER_ID }}
          ASC_KEY_P8_CONTENT: \${{ secrets.ASC_KEY_P8_CONTENT }}
          GOOGLE_PLAY_JSON_CONTENT: \${{ secrets.GOOGLE_PLAY_JSON_CONTENT }}
`

const REQUIRED_SECRETS = ['EXPO_TOKEN', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8_CONTENT', 'GOOGLE_PLAY_JSON_CONTENT']

export async function runCiInitCommand(target: string | undefined): Promise<void> {
	if (target && target !== 'github') {
		p.log.error(`alvo de CI desconhecido: "${target}". Só "github" é suportado nesta versão.`)
		process.exitCode = 1
		return
	}
	p.intro(pc.bold('release-kit ci init github'))
	const ctx = buildContext({})
	loadConfig(ctx.repoRoot) // valida que o projeto já foi inicializado

	const dir = join(ctx.repoRoot, '.github', 'workflows')
	mkdirSync(dir, { recursive: true })
	const path = join(dir, 'release-kit.yml')
	if (existsSync(path)) {
		const overwrite = await p.confirm({ message: `${path} já existe. Sobrescrever?` })
		if (p.isCancel(overwrite) || !overwrite) {
			p.outro('Nada feito.')
			return
		}
	}
	writeFileSync(path, WORKFLOW_TEMPLATE)
	p.log.success(`escrito: .github/workflows/release-kit.yml`)

	p.log.info('Cadastre os secrets do repositório (Settings → Secrets and variables → Actions):')
	for (const secret of REQUIRED_SECRETS) p.log.info(`  - ${secret}`)
	p.log.info('E crie o Environment "production" com reviewers obrigatórios (Settings → Environments) — é o que impede o job `promote` de rodar sem aprovação humana.')

	const setNow = await p.confirm({ message: 'Tentar cadastrar os secrets agora via `gh secret set`? (lê de .env.release, ignora o que não tiver)' })
	if (setNow === true) {
		await setSecretsFromEnv(ctx.repoRoot)
	}

	p.outro('CI configurado.')
}

async function setSecretsFromEnv(repoRoot: string): Promise<void> {
	const { readEnvFile } = await import('../env/store.js')
	const env = readEnvFile(repoRoot)
	const { defaultRun } = await import('../exec/run.js')
	const mapping: Record<string, string | undefined> = {
		ASC_KEY_ID: env.ASC_KEY_ID,
		ASC_ISSUER_ID: env.ASC_ISSUER_ID,
	}
	for (const [key, value] of Object.entries(mapping)) {
		if (!value) continue
		defaultRun('gh', ['secret', 'set', key, '--body', value], { cwd: repoRoot })
		p.log.success(`gh secret set ${key}`)
	}
	if (env.ASC_KEY_PATH) {
		const { readFileSync } = await import('node:fs')
		defaultRun('gh', ['secret', 'set', 'ASC_KEY_P8_CONTENT', '--body', readFileSync(env.ASC_KEY_PATH, 'utf8')], { cwd: repoRoot })
		p.log.success('gh secret set ASC_KEY_P8_CONTENT')
	}
	if (env.GOOGLE_PLAY_JSON_KEY) {
		const { readFileSync } = await import('node:fs')
		defaultRun('gh', ['secret', 'set', 'GOOGLE_PLAY_JSON_CONTENT', '--body', readFileSync(env.GOOGLE_PLAY_JSON_KEY, 'utf8')], { cwd: repoRoot })
		p.log.success('gh secret set GOOGLE_PLAY_JSON_CONTENT')
	}
	p.log.warn('EXPO_TOKEN não é lido do .env.release — cadastre manualmente (`gh secret set EXPO_TOKEN`).')
}
