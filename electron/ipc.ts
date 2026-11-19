import { registerDataIpc } from './ipc/data'
import { registerMediaIpc } from './ipc/media'
import { registerSourcesIpc } from './ipc/sources'
import { registerCatalogIpc } from './ipc/catalog'
import { registerServicesIpc } from './ipc/services'
import { registerSystemIpc } from './ipc/system'

/** IPC 注册入口：按域拆分，main.ts 只调用这一个函数 */
export function registerIpc(): void {
  registerDataIpc()
  registerMediaIpc()
  registerSourcesIpc()
  registerCatalogIpc()
  registerServicesIpc()
  registerSystemIpc()
}
