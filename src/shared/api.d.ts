import type { LaozhengApi } from './types'

declare global {
  interface Window {
    laozheng: LaozhengApi
  }
}

export {}
