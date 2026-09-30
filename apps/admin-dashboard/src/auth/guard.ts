import type { MeResponse, Role } from '@helpix/shared/api-types'

export function homeFor(me: MeResponse): string {
  return me.admin.role === 'super_admin' ? '/tenants' : '/home'
}

/** Returns true to allow navigation, or a path to redirect to. */
export function guard(meta: { public?: boolean; role?: Role }, me: MeResponse | null, hasTokens: boolean): true | string {
  const loggedIn = hasTokens && me !== null
  if (meta.public) return loggedIn ? homeFor(me!) : true
  if (!loggedIn) return '/login'
  if (meta.role && meta.role !== me!.admin.role) return homeFor(me!)
  return true
}
