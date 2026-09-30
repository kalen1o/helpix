import { buildGateway } from './app'
import { loadConfig } from './config'

const config = loadConfig()
const app = await buildGateway({ config, logger: true })
await app.listen({ port: config.port, host: '0.0.0.0' })
