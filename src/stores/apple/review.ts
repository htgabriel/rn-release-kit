import { fail } from '../../exec/run.js'
import { requireAppByBundleId } from './apps.js'
import type { AppStoreConnectClient, JsonApiCollection, JsonApiDocument } from './client.js'

/**
 * Porta de `asc_submit_review.rb` (Spaceship) para chamadas diretas à App
 * Store Connect API v1. Superfície grande e pouco documentada em um só
 * lugar — validar contra uma conta real antes de confiar em produção
 * (spike previsto no plano: "endpoints ASC de review submission e phased
 * release"). Rode sempre com --dry-run primeiro numa conta nova.
 */

interface AppStoreVersionAttributes {
	versionString: string
	platform: string
	appStoreState?: string
	releaseType?: string
	copyright?: string
}

interface BuildAttributes {
	processingState: string
	version: string
}

interface ReviewSubmissionAttributes {
	platform: string
	state: string
	submitted?: boolean
}

interface LocalizationAttributes {
	locale: string
	whatsNew?: string
}

/** READY_FOR_REVIEW fica de fora: é um rascunho, ainda não enviado à Apple. */
const SUBMITTED_STATES = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PROCESSING'])
const DRAFT_STATE = 'READY_FOR_REVIEW'
/** A Apple só permite uma versão editável por plataforma. */
const EDITABLE_VERSION_STATES = [
	'PREPARE_FOR_SUBMISSION',
	'READY_FOR_REVIEW',
	'DEVELOPER_REJECTED',
	'REJECTED',
	'METADATA_REJECTED',
	'INVALID_BINARY',
]

export interface ReviewSubmissionInput {
	bundleId: string
	versionString: string
	whatsNewByLocale: Record<string, string>
	automaticRelease?: boolean
	phasedRelease?: boolean
	copyright?: string
}

export interface ReviewSubmissionResult {
	appId: string
	appStoreVersionId: string
	buildId: string
	submissionId: string
	state: string
	alreadyInProgress: boolean
}

export async function submitForReview(client: AppStoreConnectClient, input: ReviewSubmissionInput): Promise<ReviewSubmissionResult> {
	const app = await requireAppByBundleId(client, input.bundleId)

	const submissions = await listReviewSubmissions(client, app.id)
	const inProgress = submissions.find(isSubmitted)
	if (inProgress) {
		return {
			appId: app.id,
			appStoreVersionId: '',
			buildId: '',
			submissionId: inProgress.id,
			state: inProgress.attributes.state,
			alreadyInProgress: true,
		}
	}

	const build = await findValidBuild(client, app.id, input.versionString)
	if (!build) fail(`Nenhum build VALID no TestFlight para a versão ${input.versionString}.`)

	const version = await ensureAppStoreVersion(client, app.id, input.versionString)

	if (input.copyright && !version.attributes.copyright) {
		await client.patch(`/appStoreVersions/${version.id}`, {
			data: { id: version.id, type: 'appStoreVersions', attributes: { copyright: input.copyright } },
		})
	}

	await client.patch(`/appStoreVersions/${version.id}`, {
		data: {
			id: version.id,
			type: 'appStoreVersions',
			attributes: { releaseType: input.automaticRelease ? 'AFTER_APPROVAL' : 'MANUAL' },
		},
	})

	await client.patch(`/appStoreVersions/${version.id}/relationships/build`, {
		data: { id: build.id, type: 'builds' },
	})

	if (input.phasedRelease && !(await hasPhasedRelease(client, version.id))) {
		await client.post('/appStoreVersionPhasedReleases', {
			data: {
				type: 'appStoreVersionPhasedReleases',
				attributes: { phasedReleaseState: 'INACTIVE' },
				relationships: { appStoreVersion: { data: { id: version.id, type: 'appStoreVersions' } } },
			},
		})
	}

	for (const [locale, whatsNew] of Object.entries(input.whatsNewByLocale)) {
		const localization = await findLocalization(client, version.id, locale)
		if (!localization) fail(`Localization ${locale} ausente na versão ${input.versionString} do App Store Connect.`)
		await client.patch(`/appStoreVersionLocalizations/${localization.id}`, {
			data: { id: localization.id, type: 'appStoreVersionLocalizations', attributes: { whatsNew } },
		})
	}

	const draft = submissions.find((item) => item.attributes.state === DRAFT_STATE)
	const submission = draft ?? (await createReviewSubmission(client, app.id))
	if (!draft || !(await submissionHasVersion(client, draft.id, version.id))) {
		await client.post('/reviewSubmissionItems', {
			data: {
				type: 'reviewSubmissionItems',
				relationships: {
					reviewSubmission: { data: { id: submission.id, type: 'reviewSubmissions' } },
					appStoreVersion: { data: { id: version.id, type: 'appStoreVersions' } },
				},
			},
		})
	}
	const submitted = await client.patch<JsonApiDocument<ReviewSubmissionAttributes>>(`/reviewSubmissions/${submission.id}`, {
		data: { id: submission.id, type: 'reviewSubmissions', attributes: { submitted: true } },
	})

	return {
		appId: app.id,
		appStoreVersionId: version.id,
		buildId: build.id,
		submissionId: submission.id,
		state: submitted.data.attributes.state,
		alreadyInProgress: false,
	}
}

export interface IosStatus {
	appId: string
	versionString: string
	appStoreState: string | null
	reviewSubmissionState: string | null
}

/** Usado por `release-kit status`: estado da versão + de uma submission em andamento, se houver. */
export async function getIosStatus(client: AppStoreConnectClient, bundleId: string, versionString: string): Promise<IosStatus> {
	const app = await requireAppByBundleId(client, bundleId)
	const version = await findAppStoreVersion(client, app.id, versionString)
	const inProgress = (await listReviewSubmissions(client, app.id)).find(isSubmitted)
	return {
		appId: app.id,
		versionString,
		appStoreState: version?.attributes.appStoreState ?? null,
		reviewSubmissionState: inProgress?.attributes.state ?? null,
	}
}

type ReviewSubmission = JsonApiCollection<ReviewSubmissionAttributes>['data'][number]

async function listReviewSubmissions(client: AppStoreConnectClient, appId: string): Promise<ReviewSubmission[]> {
	const result = await client.get<JsonApiCollection<ReviewSubmissionAttributes>>(
		`/apps/${appId}/reviewSubmissions?filter[platform]=IOS`
	)
	return result.data
}

function isSubmitted(submission: ReviewSubmission): boolean {
	return SUBMITTED_STATES.has(submission.attributes.state)
}

async function submissionHasVersion(client: AppStoreConnectClient, submissionId: string, versionId: string): Promise<boolean> {
	const items = await client.get<{
		data: Array<{ relationships?: { appStoreVersion?: { data?: { id: string } | null } } }>
	}>(`/reviewSubmissions/${submissionId}/items?include=appStoreVersion&limit=200`)
	return items.data.some((item) => item.relationships?.appStoreVersion?.data?.id === versionId)
}

async function hasPhasedRelease(client: AppStoreConnectClient, versionId: string): Promise<boolean> {
	const result = await client.get<{ data: unknown }>(`/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`)
	return Boolean(result.data)
}

async function ensureAppStoreVersion(
	client: AppStoreConnectClient,
	appId: string,
	versionString: string
): Promise<{ id: string; attributes: AppStoreVersionAttributes }> {
	const existing = await findAppStoreVersion(client, appId, versionString)
	if (existing) return existing

	const editable = await findEditableAppStoreVersion(client, appId)
	if (editable) {
		await client.patch(`/appStoreVersions/${editable.id}`, {
			data: { id: editable.id, type: 'appStoreVersions', attributes: { versionString } },
		})
		return { id: editable.id, attributes: { ...editable.attributes, versionString } }
	}

	const created = await client.post<JsonApiDocument<AppStoreVersionAttributes>>('/appStoreVersions', {
		data: {
			type: 'appStoreVersions',
			attributes: { platform: 'IOS', versionString },
			relationships: { app: { data: { id: appId, type: 'apps' } } },
		},
	})
	return { id: created.data.id, attributes: created.data.attributes }
}

async function findAppStoreVersion(
	client: AppStoreConnectClient,
	appId: string,
	versionString: string
): Promise<{ id: string; attributes: AppStoreVersionAttributes } | null> {
	const result = await client.get<JsonApiCollection<AppStoreVersionAttributes>>(
		`/apps/${appId}/appStoreVersions?filter[versionString]=${encodeURIComponent(versionString)}&filter[platform]=IOS`
	)
	const [version] = result.data
	return version ? { id: version.id, attributes: version.attributes } : null
}

async function findEditableAppStoreVersion(
	client: AppStoreConnectClient,
	appId: string
): Promise<{ id: string; attributes: AppStoreVersionAttributes } | null> {
	const result = await client.get<JsonApiCollection<AppStoreVersionAttributes>>(
		`/apps/${appId}/appStoreVersions?filter[appStoreState]=${EDITABLE_VERSION_STATES.join(',')}&filter[platform]=IOS`
	)
	const [version] = result.data
	return version ? { id: version.id, attributes: version.attributes } : null
}

async function findValidBuild(
	client: AppStoreConnectClient,
	appId: string,
	versionString: string
): Promise<{ id: string; attributes: BuildAttributes } | null> {
	const result = await client.get<JsonApiCollection<BuildAttributes>>(
		`/builds?filter[app]=${appId}&filter[preReleaseVersion.version]=${encodeURIComponent(versionString)}&sort=-uploadedDate&limit=20`
	)
	const valid = result.data.find((item) => item.attributes.processingState === 'VALID')
	const build = valid ?? result.data[0]
	return build ? { id: build.id, attributes: build.attributes } : null
}

async function findLocalization(
	client: AppStoreConnectClient,
	versionId: string,
	locale: string
): Promise<{ id: string; attributes: LocalizationAttributes } | null> {
	const result = await client.get<JsonApiCollection<LocalizationAttributes>>(
		`/appStoreVersions/${versionId}/appStoreVersionLocalizations`
	)
	const match = result.data.find((item) => item.attributes.locale === locale)
	return match ? { id: match.id, attributes: match.attributes } : null
}

async function createReviewSubmission(
	client: AppStoreConnectClient,
	appId: string
): Promise<{ id: string; attributes: ReviewSubmissionAttributes }> {
	const created = await client.post<JsonApiDocument<ReviewSubmissionAttributes>>('/reviewSubmissions', {
		data: {
			type: 'reviewSubmissions',
			attributes: { platform: 'IOS' },
			relationships: { app: { data: { id: appId, type: 'apps' } } },
		},
	})
	return { id: created.data.id, attributes: created.data.attributes }
}
