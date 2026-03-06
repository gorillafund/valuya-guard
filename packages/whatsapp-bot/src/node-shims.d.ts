declare module "node:http" {
  export const createServer: any
}

declare module "node:crypto" {
  export const randomBytes: any
  export const randomUUID: any
  export const createHmac: any
  export const timingSafeEqual: any
}

declare module "node:path" {
  export const resolve: (...parts: string[]) => string
  export const dirname: (path: string) => string
}

declare module "node:fs/promises" {
  export const mkdir: any
  export const readFile: any
  export const writeFile: any
}

declare const process: any
declare const Buffer: any
