import { defineConfig } from 'tsup'

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'cli/index': 'src/cli/index.ts',
	},
	format: ['esm'],
	target: 'node20',
	platform: 'node',
	dts: true,
	sourcemap: true,
	splitting: false,
	clean: true,
	shims: false,
})
