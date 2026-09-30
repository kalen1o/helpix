import type { Db } from '@helpix/shared'
import type { Config } from './config'
import type { TokenService } from './lib/tokens'

export interface RouteDeps {
  db: Db
  config: Config
  tokens: TokenService
}
