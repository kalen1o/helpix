import bcrypt from 'bcryptjs'

export const MIN_PASSWORD_LENGTH = 8

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** Compared against when the email is unknown, so both paths cost one bcrypt check. */
export const DUMMY_HASH = bcrypt.hashSync('helpix-dummy-password', 10)
