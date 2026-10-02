import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'

// Orchard Store's own backend: shopper accounts, fake checkout and the order API Helpix calls. Port 4101 on all
// interfaces, so tenant-auth in Docker can reach it through host.docker.internal.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await buildApp({ dataDir: join(root, '.data'), seedDir: join(root, 'seed'), logger: true })
await app.listen({ host: '0.0.0.0', port: 4101 })
