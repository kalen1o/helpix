/** An error with an HTTP status, sent as `{ error: { code, message, field? } }`. `field` names the form input it is about. */
export class ShopError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message)
    this.name = 'ShopError'
  }
}
