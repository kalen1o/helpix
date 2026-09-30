export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export interface ErrorBody {
  error: { code: string; message: string; requestId: string }
}

export function errorBody(code: string, message: string, requestId: string): ErrorBody {
  return { error: { code, message, requestId } }
}
