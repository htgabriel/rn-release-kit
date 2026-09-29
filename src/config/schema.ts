import { z } from 'zod'

export const platformSchema = z.enum(['android', 'ios'])
export type Platform = z.infer<typeof platformSchema>

export const versionSourceSchema = z.enum(['app.json', 'package.json'])

export const gitPolicySchema = z.object({
	releaseBranch: z.string().default('main'),
	tagFormat: z.string().default('v{version}'),
	requireClean: z.boolean().default(true),
	requireSyncedWithRemote: z.boolean().default(true),
	remote: z.string().default('origin'),
})
export type GitPolicy = z.infer<typeof gitPolicySchema>

const iosChannelSchema = z.object({
	bundleId: z.string(),
	ascAppId: z.string().optional(),
	appleTeamId: z.string().optional(),
	phasedRelease: z.boolean().default(false),
	automaticRelease: z.boolean().default(false),
	copyright: z.string().optional(),
})

const androidChannelSchema = z.object({
	package: z.string(),
	testTrack: z.string().default('internal'),
	productionTrack: z.string().default('production'),
	initialRollout: z.number().min(0).max(1).default(1),
})

const otaSchema = z.object({
	channel: z.string(),
})

export const channelSchema = z.object({
	/** Canal protegido (produção): exige --i-know-this-is-production ou confirmação digitando a versão. */
	protected: z.boolean().default(false),
	/** Se false, o canal nunca envia à loja (ex: build local de sideload). */
	store: z.boolean().default(true),
	buildProfile: z.string(),
	submitProfile: z.string().optional(),
	/** Nome do "environment" do EAS (eas.json build.<profile>.environment) — usado nos checks de fingerprint/Sentry. */
	easEnvironment: z.string().optional(),
	/** Se o build profile já reusa o build number/versionCode (eas.json autoIncrement). */
	autoIncrement: z.boolean().default(true),
	/** Profiles com upload de sourcemap desligado (ex: SENTRY_DISABLE_AUTO_UPLOAD) não exigem token no doctor. */
	sentryUploadDisabled: z.boolean().default(false),
	env: z.record(z.string(), z.string()).default({}),
	ios: iosChannelSchema.optional(),
	android: androidChannelSchema.optional(),
	ota: otaSchema.optional(),
})
export type ChannelConfig = z.infer<typeof channelSchema>

export const toolchainBaselineSchema = z.object({
	easCli: z.object({ min: z.string(), tested: z.string() }).optional(),
	node: z.object({ min: z.string(), tested: z.string() }).optional(),
	jdk: z.object({ min: z.string(), tested: z.string() }).optional(),
	xcode: z.object({ min: z.string(), tested: z.string() }).optional(),
	cocoapods: z.object({ min: z.string(), tested: z.string() }).optional(),
})
export type ToolchainBaseline = z.infer<typeof toolchainBaselineSchema>

export const doctorConfigSchema = z.object({
	sentry: z.boolean().default(false),
	expoDoctor: z.boolean().default(true),
})

export const releaseKitConfigSchema = z.object({
	$schema: z.string().optional(),
	appDir: z.string().default('.'),
	/** Conta/organização esperada no `eas whoami` (opcional; reforça o doctor). */
	easOwner: z.string().optional(),
	platforms: z.array(platformSchema).min(1),
	locales: z.array(z.string()).min(1).default(['pt-BR']),
	notesDir: z.string().default('release-notes'),
	version: z.object({ source: versionSourceSchema.default('app.json') }).default({ source: 'app.json' }),
	git: gitPolicySchema.default({}),
	channels: z.record(z.string(), channelSchema).refine((channels) => Object.keys(channels).length > 0, {
		message: 'defina ao menos um canal em "channels"',
	}),
	toolchain: toolchainBaselineSchema.default({}),
	doctor: doctorConfigSchema.default({}),
})
export type ReleaseKitConfig = z.infer<typeof releaseKitConfigSchema>

export function parseConfig(input: unknown): ReleaseKitConfig {
	return releaseKitConfigSchema.parse(input)
}

export function defaultLocale(config: ReleaseKitConfig): string {
	const [first] = config.locales
	if (!first) throw new Error('config.locales está vazio')
	return first
}

export function channelOf(config: ReleaseKitConfig, name: string): ChannelConfig {
	const channel = config.channels[name]
	if (!channel) {
		const available = Object.keys(config.channels).join(', ')
		throw new Error(`canal desconhecido: "${name}". Canais disponíveis: ${available}`)
	}
	return channel
}

export function protectedChannelNames(config: ReleaseKitConfig): string[] {
	return Object.entries(config.channels)
		.filter(([, channel]) => channel.protected)
		.map(([name]) => name)
}
