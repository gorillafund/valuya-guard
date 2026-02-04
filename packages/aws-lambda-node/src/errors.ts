export class ValuyaConfigError extends Error {}
export class ValuyaHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
