import { writeFileSync } from 'node:fs'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { releaseKitConfigSchema } from '../src/config/schema.js'

const schema = zodToJsonSchema(releaseKitConfigSchema, 'ReleaseKitConfig')
writeFileSync('schema.json', `${JSON.stringify(schema, null, 2)}\n`)
console.log('schema.json escrito.')
