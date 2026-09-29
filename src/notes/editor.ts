import type { ReleaseKitContext } from '../context.js'
import { requireSuccess } from '../exec/run.js'

function defaultEditor(): string {
	if (process.platform === 'win32') return 'notepad'
	return 'nano'
}

/** Abre `path` no $EDITOR (com fallback por SO) e bloqueia até o editor fechar. */
export function openInEditor(ctx: ReleaseKitContext, path: string): void {
	const editor = ctx.env.EDITOR || ctx.env.VISUAL || defaultEditor()
	const [command, ...args] = editor.split(' ')
	if (!command) return
	requireSuccess(ctx.run(command, [...args, path], { inherit: true }), `${editor} ${path}`)
}
