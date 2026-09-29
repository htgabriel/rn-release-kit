import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { detectAppDir, detectPackageManager, readEasJson } from '../project/detect.js'
import { resolveExpoConfig } from '../project/expo.js'
import { buildContext } from './resolve.js'
import type { ReleaseKitContext } from '../context.js'
import { readEnvFile, storeCredentialFile, writeEnvFile } from '../env/store.js'
import { configExists, writeConfig } from '../config/load.js'
import { channelSchema, releaseKitConfigSchema, type ChannelConfig, type Platform, type ReleaseKitConfig } from '../config/schema.js'
import { assertEasCliAvailable, easInit, easWhoami } from '../eas/cli.js'
import { AppStoreConnectClient } from '../stores/apple/client.js'
import { findAppByBundleId } from '../stores/apple/apps.js'
import { AndroidPublisherClient } from '../stores/google/client.js'
import { parseServiceAccountJson } from '../stores/google/auth.js'
import { validatePlayAccess } from '../stores/google/tracks.js'
import { runDoctor, printDoctorReport } from '../doctor/run.js'

function cancel(message = 'Setup cancelado.'): never {
	p.cancel(message)
	process.exit(1)
}

/**
 * Wizard `release-kit init`: pede credencial após credencial (Expo → Apple
 * → Google), valida cada uma contra a API real antes de seguir, e só
 * escreve config/.env no final. Idempotente — roda de novo pra corrigir
 * uma etapa sem repetir o resto.
 */
export async function runInitWizard(): Promise<void> {
	p.intro(pc.bold('release-kit init'))

	const repoRoot = process.cwd().includes('.git') ? process.cwd() : findGitRootOrCwd()
	const ctxBase = buildContext({})
	const slug = basenameSlug(ctxBase.repoRoot)

	// 1. Projeto
	const packageManager = detectPackageManager(ctxBase.repoRoot)
	const detectedAppDir = detectAppDir(ctxBase.repoRoot)
	const appDirRelative =
		detectedAppDir ??
		(await promptText('Diretório do app Expo (relativo à raiz do repo)', '.'))
	const appDir = resolve(ctxBase.repoRoot, appDirRelative)
	if (!existsSync(join(appDir, 'app.json'))) {
		cancel(`app.json não encontrado em ${appDir}. Rode este comando na raiz de um projeto Expo, ou informe o diretório certo.`)
	}
	p.log.success(`projeto: ${packageManager}, appDir=${appDirRelative}`)

	const ctx: ReleaseKitContext = { ...ctxBase, appDir }

	// 2. Ferramentas
	assertEasCliAvailable(ctx)
	p.log.success('eas-cli encontrado no PATH')
	warnPlatformLimits()

	// 3. Expo/EAS
	await ensureEasLogin(ctx)

	// 4. Canais
	const easJson = readEasJson(appDir)
	if (!easJson) cancel(`eas.json não encontrado em ${appDirRelative}. Rode \`eas init\` primeiro ou aponte para o appDir certo.`)
	const platforms = await promptPlatforms()
	const channels = await defineChannels(ctx, easJson, platforms)

	// 5/6. Credenciais Apple/Google
	const envUpdates: Record<string, string> = {}
	if (platforms.includes('ios')) {
		await runAppleCredentialsStep(ctx, slug, channels, envUpdates)
	}
	if (platforms.includes('android')) {
		await runGoogleCredentialsStep(slug, channels, envUpdates)
	}

	// 7. Sync EAS (com confirmação)
	if (Object.keys(envUpdates).length > 0) {
		const sync = await p.confirm({
			message: 'Configurar essas credenciais também no EAS (env vars/credentials), pra build/submit na nuvem e CI funcionarem sem prompt?',
		})
		if (sync === true) {
			p.log.info('Rode manualmente por enquanto: `eas credentials` (ASC key / Play SA) e `eas env:create` para as demais env vars. Automação completa fica para uma versão futura do release-kit.')
		}
	}

	// 8. Escrita
	const locales = await promptLocales()
	const config: ReleaseKitConfig = releaseKitConfigSchema.parse({
		appDir: appDirRelative,
		platforms,
		locales,
		channels,
	})
	writeConfig(ctx.repoRoot, config)
	if (Object.keys(envUpdates).length > 0) writeEnvFile(ctx.repoRoot, envUpdates)
	ensureGitignoreEntries(ctx.repoRoot)
	mkdirSync(join(appDir, config.notesDir), { recursive: true })
	addReleaseScript(ctx.repoRoot, packageManager)

	p.log.success(`escrito: release-kit.config.json, .env.release, ${config.notesDir}/`)

	// 9. Doctor final
	const finalCtx = { ...ctx, releaseDir: join(appDir, '.release'), env: { ...process.env, ...readEnvFile(ctx.repoRoot) } }
	try {
		const report = runDoctor(finalCtx, config, {})
		printDoctorReport(report, finalCtx)
	} catch (error) {
		p.log.warn(`doctor encontrou pendências: ${(error as Error).message}`)
	}

	p.outro('Setup concluído. Próximo passo: `release-kit doctor --channel <canal> --platform <plataforma>`.')
}

function findGitRootOrCwd(): string {
	return process.cwd()
}

function basenameSlug(repoRoot: string): string {
	return repoRoot.split('/').filter(Boolean).pop() ?? 'release-kit-project'
}

async function promptText(message: string, initialValue?: string): Promise<string> {
	const value = await p.text({ message, initialValue })
	if (p.isCancel(value)) cancel()
	return value
}

function warnPlatformLimits(): void {
	if (process.platform === 'win32') {
		p.log.warn('Windows: build local de iOS não é suportado (precisa de macOS) e build local de Android exige WSL2. Use --cloud nesses casos.')
	} else if (process.platform === 'linux') {
		p.log.warn('Linux: build local de iOS não é suportado (precisa de macOS). Android funciona normalmente.')
	}
}

export async function ensureEasLogin(ctx: ReleaseKitContext): Promise<void> {
	const whoami = easWhoami(ctx)
	if (whoami.ok) {
		p.log.success(`eas: autenticado${whoami.account ? ` como ${whoami.account}` : ''}`)
		return
	}
	const choice = await p.select({
		message: 'Não autenticado no EAS. Como prefere entrar?',
		options: [
			{ value: 'login', label: 'eas login (abre o fluxo interativo do eas-cli)' },
			{ value: 'token', label: 'Colar um EXPO_TOKEN' },
		],
	})
	if (p.isCancel(choice)) cancel()
	if (choice === 'login') {
		ctx.run('eas', ['login'], { inherit: true })
	} else {
		const token = await promptText('EXPO_TOKEN')
		process.env.EXPO_TOKEN = token
	}
	const retry = easWhoami(ctx)
	if (!retry.ok) cancel('Ainda não autenticado no EAS. Rode `release-kit init` de novo depois de `eas login`.')
	p.log.success(`eas: autenticado${retry.account ? ` como ${retry.account}` : ''}`)

	const easJson = readEasJson(ctx.appDir)
	if (!easJson) {
		const doInit = await p.confirm({ message: 'eas.json não encontrado. Rodar `eas init` agora?' })
		if (doInit === true) {
			ctx.run('eas', ['init', '--non-interactive'], { cwd: ctx.appDir, inherit: true })
		}
	}
}

async function promptPlatforms(): Promise<Platform[]> {
	const selected = await p.multiselect({
		message: 'Quais plataformas este projeto publica?',
		options: [
			{ value: 'android', label: 'Android (Google Play)' },
			{ value: 'ios', label: 'iOS (App Store)' },
		],
		initialValues: ['android', 'ios'],
	})
	if (p.isCancel(selected)) cancel()
	return selected as Platform[]
}

async function promptLocales(): Promise<string[]> {
	const raw = await p.text({ message: 'Locales das notas de loja, separados por vírgula', initialValue: 'pt-BR' })
	if (p.isCancel(raw)) cancel()
	return raw.split(',').map((l) => l.trim()).filter(Boolean)
}

async function defineChannels(ctx: ReleaseKitContext, easJson: Record<string, unknown>, platforms: Platform[]): Promise<Record<string, ChannelConfig>> {
	const build = (easJson.build as Record<string, unknown>) ?? {}
	const profileNames = Object.keys(build).filter((name) => name !== 'development')
	p.log.info(`build profiles encontrados no eas.json: ${profileNames.join(', ') || '(nenhum)'}`)

	const channels: Record<string, ChannelConfig> = {}
	for (const name of profileNames) {
		const use = await p.confirm({ message: `Criar o canal "${name}" a partir deste build profile?`, initialValue: true })
		if (p.isCancel(use) || !use) continue
		const isProtected = await p.confirm({ message: `"${name}" é um canal protegido (produção — gate fail-closed)?`, initialValue: name === 'production' })
		if (p.isCancel(isProtected)) cancel()
		const goesToStore = await p.confirm({ message: `"${name}" envia à loja (submit)?`, initialValue: true })
		if (p.isCancel(goesToStore)) cancel()

		const channel: Partial<ChannelConfig> = {
			protected: isProtected,
			store: goesToStore,
			buildProfile: name,
			submitProfile: name,
			env: {},
		}

		if (goesToStore) {
			for (const platform of platforms) {
				const envForConfig = await tryResolveEnv(ctx, platform, name)
				if (platform === 'ios') {
					const bundleId = await promptText(`bundleId iOS para "${name}"`, envForConfig?.ios?.bundleIdentifier)
					channel.ios = { bundleId, phasedRelease: isProtected, automaticRelease: false }
				}
				if (platform === 'android') {
					const packageName = await promptText(`package Android para "${name}"`, envForConfig?.android?.package)
					channel.android = { package: packageName, testTrack: 'internal', productionTrack: isProtected ? 'production' : 'internal', initialRollout: isProtected ? 0.1 : 1 }
				}
			}
		}

		channels[name] = channelSchema.parse(channel)
	}

	if (Object.keys(channels).length === 0) cancel('Nenhum canal configurado — o kit precisa de ao menos um.')
	return channels
}

async function tryResolveEnv(ctx: ReleaseKitContext, platform: Platform, profileName: string) {
	try {
		return resolveExpoConfig(ctx, { APP_VARIANT: profileName })
	} catch {
		return null
	}
}

export async function runAppleCredentialsStep(
	ctx: ReleaseKitContext,
	slug: string,
	channels: Record<string, ChannelConfig>,
	envUpdates: Record<string, string>
): Promise<void> {
	p.log.step('App Store Connect API Key')
	p.log.info('Crie em https://appstoreconnect.apple.com/access/integrations/api — role "App Manager" (ou "Admin").')

	const keyId = await promptText('ASC_KEY_ID (Key ID)')
	const issuerId = await promptText('ASC_ISSUER_ID (Issuer ID)')
	const keyPathRaw = await promptText('Caminho do arquivo .p8 baixado')
	const keyPath = resolve(keyPathRaw)
	if (!existsSync(keyPath)) cancel(`Arquivo não encontrado: ${keyPath}`)

	const privateKeyPem = readFileSync(keyPath, 'utf8')
	const client = new AppStoreConnectClient({ credentials: { keyId, issuerId, privateKeyPem } })

	const spinner = p.spinner()
	spinner.start('Validando chave contra a App Store Connect API')
	try {
		for (const [name, channel] of Object.entries(channels)) {
			if (!channel.ios) continue
			const app = await findAppByBundleId(client, channel.ios.bundleId)
			if (!app) {
				spinner.stop(`Chave válida, mas nenhum app com bundleId ${channel.ios.bundleId} encontrado (canal "${name}").`, 1)
				const proceed = await p.confirm({ message: 'Continuar assim mesmo? (o app pode ainda não existir no App Store Connect)' })
				if (p.isCancel(proceed) || !proceed) cancel()
				spinner.start('Continuando')
			} else {
				channel.ios.ascAppId = app.id
			}
		}
		spinner.stop('App Store Connect: chave validada.')
	} catch (error) {
		spinner.stop(`Falha ao validar a chave: ${(error as Error).message}`, 1)
		cancel()
	}

	const dest = storeCredentialFile(slug, keyPath, `AuthKey_${keyId}.p8`)
	envUpdates.ASC_KEY_ID = keyId
	envUpdates.ASC_ISSUER_ID = issuerId
	envUpdates.ASC_KEY_PATH = dest
	p.log.success(`.p8 copiada para ${dest} (fora do repositório).`)
}

export async function runGoogleCredentialsStep(slug: string, channels: Record<string, ChannelConfig>, envUpdates: Record<string, string>): Promise<void> {
	p.log.step('Google Play service account')
	p.log.info('Crie em Google Cloud Console → IAM → Service Accounts, e conceda acesso em Play Console → Utilizadores e permissões.')

	const jsonPathRaw = await promptText('Caminho do JSON da service account')
	const jsonPath = resolve(jsonPathRaw)
	if (!existsSync(jsonPath)) cancel(`Arquivo não encontrado: ${jsonPath}`)

	const account = parseServiceAccountJson(readFileSync(jsonPath, 'utf8'))
	const client = new AndroidPublisherClient({ account })

	const spinner = p.spinner()
	spinner.start('Validando acesso à Android Publisher API')
	try {
		for (const [name, channel] of Object.entries(channels)) {
			if (!channel.android) continue
			try {
				await validatePlayAccess(client, channel.android.package)
			} catch (error) {
				spinner.stop(`Falha ao acessar o package ${channel.android.package} (canal "${name}"): ${(error as Error).message}`, 1)
				p.log.warn('Causas comuns: app ainda não criado na Play, primeiro AAB nunca enviado manualmente, ou a service account sem permissão no Play Console.')
				const proceed = await p.confirm({ message: 'Continuar assim mesmo?' })
				if (p.isCancel(proceed) || !proceed) cancel()
				spinner.start('Continuando')
			}
		}
		spinner.stop('Google Play: acesso validado.')
	} catch (error) {
		spinner.stop(`Falha: ${(error as Error).message}`, 1)
		cancel()
	}

	const dest = storeCredentialFile(slug, jsonPath, 'play-service-account.json')
	envUpdates.GOOGLE_PLAY_JSON_KEY = dest
	p.log.success(`JSON copiado para ${dest} (fora do repositório).`)
}

function ensureGitignoreEntries(repoRoot: string): void {
	const path = join(repoRoot, '.gitignore')
	const entries = ['.env.release', '.release/']
	const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
	const missing = entries.filter((entry) => !current.includes(entry))
	if (missing.length === 0) return
	writeFileSync(path, `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}${missing.join('\n')}\n`)
}

function addReleaseScript(repoRoot: string, packageManager: string): void {
	const path = join(repoRoot, 'package.json')
	if (!existsSync(path)) return
	const json = JSON.parse(readFileSync(path, 'utf8')) as { scripts?: Record<string, string> }
	json.scripts = json.scripts ?? {}
	if (!json.scripts.release) {
		json.scripts.release = 'release-kit'
		writeFileSync(path, `${JSON.stringify(json, null, '\t')}\n`)
	}
	void packageManager
}
