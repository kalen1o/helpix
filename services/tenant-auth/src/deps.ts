import type { Db } from '@helpix/shared'
import type { Config } from './config'
import type { ShopClient } from './lib/shopClient'
import type { TokenService } from './lib/tokens'

export interface RouteDeps {
  db: Db
  config: Config
  tokens: TokenService
  /** Calls shops' order APIs. The only code that ever holds a decrypted order API key. */
  shop: ShopClient
}
