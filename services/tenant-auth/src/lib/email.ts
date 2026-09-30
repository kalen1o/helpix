import { AppError } from '@helpix/shared'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function assertValidEmail(email: string): void {
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new AppError(400, 'invalid_email', 'Enter a valid email address')
}
