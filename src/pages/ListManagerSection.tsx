import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import type { CollectionItem, ItemList, ListItem } from '../shared/types'
import { SINGING_MANUAL_CATEGORY, singingCategoryPath, singingCategoryTree, type SingingVideo } from '../shared/singing'
import { useData } from '../state/DataContext'
import { countItems, descendantIds, nextId } from '../utils/data'
import { ConfirmDialog, Modal, PromptDialog } from '../components/ui'

/**
 * 清单管理（配置管理 → 清单管理，参考手机端）：
 * 展示全部清单树，默认收紧；点带子清单的行展开/收起，可新建、重命名、删除。
 * 删除清单会连同其子清单与清单内关联一起移除（收藏条目本身保留）。
 */
export function ListManagerSection({
  onNotice,
  developerMode
}: {
  onNotice: (text: string) => void
  /** 开发者模式下才显示演唱添加 / 改名；密码在设置页右上角统一输入 */
  developerMode: boolean
}) {
  const { data, update } = useData()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ItemList | null>(null)
  const [deleting, setDeleting] = useState<ItemList | null>(null)
  const [singingRenameTarget, setSingingRenameTarget] = useState<SingingVideo | null>(null)
  const [singingQuery, setSingingQuery] = useState('')
  const [singingLevel1, setSingingLevel1] = useState('')
  const [singingLevel2, setSingingLevel2] = useState('')
  const [singingLevel3, setSingingLevel3] = useState('')
  const [singingAddOpen, setSingingAddOpen] = useState(false)
  const [singingLink, setSingingLink] = useState('')
  const [singingTitle, setSingingTitle] = useState('')
  const [singingCategory, setSingingCategory] = useState('')
  const [singingBusy, setSingingBusy] = useState(false)
  const [singingError, setSingingError] = useState('')
  const singingCategories = [...new Set(data.singingVideos.map((video) => video.category))]
  const singingTree = useMemo(() => singingCategoryTree(data.singingVideos), [data.singingVideos])
  const singingLevel1Node = singingTree.find((node) => node.name === singingLevel1)
  const singingLevel2Node = singingLevel1Node?.children.find((node) => node.name === singingLevel2)
  const singingFiltered = useMemo(() => {
    const keyword = singingQuery.trim().toLowerCase()
    return [...data.singingVideos]
      .filter((video) => {
        if (singingLevel1 || singingLevel2 || singingLevel3) {
          const path = singingCategoryPath(video.category)
          if (singingLevel1 && path[0] !== singingLevel1) return false
          if (singingLevel2 && (path[1] ?? '') !== singingLevel2) return false
          if (singingLevel3 && (path[2] ?? '') !== singingLevel3) return false
        }
        if (!keyword) return true
        return (
          video.title.toLowerCase().includes(keyword) ||
          video.category.toLowerCase().includes(keyword) ||
          video.owner.toLowerCase().includes(keyword) ||
          video.bvid.toLowerCase().includes(keyword)
        )
      })
      .sort((a, b) => (b.favAt || b.addedAt) - (a.favAt || a.addedAt))
  }, [data.singingVideos, singingQuery, singingLevel1, singingLevel2, singingLevel3])

  const childrenOf = (parentId: number | null): ItemList[] =>
    data.lists
      .filter((l) => (parentId == null ? l.parentId == null : l.parentId === parentId))
      .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)

  const createList = (name: string) => {
    update((d) => ({
      ...d,
      lists: [
        ...d.lists,
        {
          id: nextId(d.lists),
          name,
          description: '',
          coverUrl: null,
          parentId: null,
          sortIndex: childrenOf(null).length,
          world: 0,
          musicList: false,
          createdAt: Date.now()
        }
      ]
    }))
    setCreating(false)
    onNotice(`已创建清单「${name}」`)
  }

  const renameList = (name: string) => {
    if (!renaming) return
    update((d) => ({
      ...d,
      lists: d.lists.map((l) => (l.id === renaming.id ? { ...l, name } : l))
    }))
    setRenaming(null)
    onNotice(`已重命名为「${name}」`)
  }

  const deleteList = () => {
    if (!deleting) return
    const ids = descendantIds(data, deleting.id)
    const name = deleting.name
    update((d) => ({
      ...d,
      lists: d.lists.filter((l) => !ids.has(l.id)),
      listItems: d.listItems.filter((r) => !ids.has(r.listId))
    }))
    setDeleting(null)
    onNotice(`已删除清单「${name}」`)
  }

  const exportLists = async (): Promise<void> => {
    if (!data.lists.length) return
    const res = await window.laozheng.exportLists({
      lists: data.lists,
      listItems: data.listItems,
      items: data.items
    })
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个清单到 ${res.path}`)
  }

  const importLists = async (): Promise<void> => {
    const res = await window.laozheng.importLists()
    if (res.canceled) return
    if (res.error || !res.data) {
      onNotice(`导入失败：${res.error ?? '文件内容无效'}`)
      return
    }
    const bundle = res.data
    let addedLists = 0
    let addedItems = 0

    update((d) => {
      const nextItems = [...d.items]
      const nextLists = [...d.lists]
      const nextListItems = [...d.listItems]

      // 条目按「分类 + 豆瓣 id」复用，缺失豆瓣 id 时退回标题 + 年份
      const itemKeyOf = (item: CollectionItem): string =>
        item.doubanId
          ? `${item.category}|${item.doubanId}`
          : `${item.category}|${item.title}|${item.year}`
      const itemIdByKey = new Map(nextItems.map((item) => [itemKeyOf(item), item.id]))
      const itemIdMap = new Map<number, number>()
      for (const raw of bundle.items) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as CollectionItem
        if (typeof item.id !== 'number' || !Number.isFinite(item.id)) continue
        const key = itemKeyOf(item)
        const existingId = itemIdByKey.get(key)
        if (existingId != null) {
          itemIdMap.set(item.id, existingId)
          continue
        }
        const id = nextId(nextItems)
        nextItems.push({ ...item, id })
        itemIdByKey.set(key, id)
        itemIdMap.set(item.id, id)
        addedItems += 1
      }

      // 清单按层级从浅到深导入；同名同父级复用，重复导入不会产生重复清单
      const sourceLists = bundle.lists.filter(
        (list): list is ItemList =>
          !!list && typeof list === 'object' && typeof (list as ItemList).id === 'number'
      )
      const sourceById = new Map(sourceLists.map((list) => [list.id, list]))
      const depthOf = (id: number, seen: Set<number>): number => {
        const list = sourceById.get(id)
        if (!list || list.parentId == null || seen.has(id)) return 0
        seen.add(id)
        return 1 + depthOf(list.parentId, seen)
      }
      const ordered = [...sourceLists].sort(
        (a, b) => depthOf(a.id, new Set()) - depthOf(b.id, new Set())
      )
      const listIdMap = new Map<number, number>()
      for (const raw of ordered) {
        const parentId = raw.parentId != null ? listIdMap.get(raw.parentId) ?? null : null
        const name =
          typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '未命名清单'
        const existing = nextLists.find(
          (list) =>
            list.name === name &&
            (parentId == null ? list.parentId == null : list.parentId === parentId)
        )
        let id: number
        if (existing) {
          id = existing.id
        } else {
          id = nextId(nextLists)
          nextLists.push({
            id,
            name,
            description: typeof raw.description === 'string' ? raw.description : '',
            coverUrl: typeof raw.coverUrl === 'string' ? raw.coverUrl : null,
            parentId,
            sortIndex: nextLists.filter((list) =>
              parentId == null ? list.parentId == null : list.parentId === parentId
            ).length,
            world: 0,
            musicList: raw.musicList === true,
            createdAt:
              typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
                ? raw.createdAt
                : Date.now()
          })
          addedLists += 1
        }
        listIdMap.set(raw.id, id)
      }

      const seenRel = new Set(nextListItems.map((rel) => `${rel.listId}|${rel.itemId}`))
      for (const raw of bundle.listItems) {
        if (!raw || typeof raw !== 'object') continue
        const rel = raw as ListItem
        const listId = listIdMap.get(rel.listId)
        const itemId = itemIdMap.get(rel.itemId)
        if (listId == null || itemId == null) continue
        const key = `${listId}|${itemId}`
        if (seenRel.has(key)) continue
        seenRel.add(key)
        nextListItems.push({
          listId,
          itemId,
          orderIndex:
            typeof rel.orderIndex === 'number' && Number.isFinite(rel.orderIndex)
              ? rel.orderIndex
              : 0
        })
      }

      return { ...d, items: nextItems, lists: nextLists, listItems: nextListItems }
    })

    if (!addedLists && !addedItems) {
      onNotice('没有新增内容（清单与条目都已存在）')
      return
    }
    onNotice(`已导入 ${addedLists} 个清单 · ${addedItems} 件条目`)
  }

  const submitSingingAdd = async (): Promise<void> => {
    if (singingBusy) return
    const link = singingLink.trim()
    if (!link) {
      setSingingError('请粘贴 B站视频链接、BV 号或 av 号')
      return
    }
    setSingingBusy(true)
    setSingingError('')
    try {
      const info = await window.laozheng.singingVideoInfo(link)
      if (info.error) {
        setSingingError(info.error)
        return
      }
      const existing = data.singingVideos.find((video) => video.bvid === info.bvid)
      const entry: SingingVideo = {
        bvid: info.bvid,
        page: info.page,
        title: singingTitle.trim() || existing?.title || info.title,
        originalTitle: info.title,
        cover: info.cover,
        durationSec: info.durationSec,
        category: singingCategory.trim() || existing?.category || SINGING_MANUAL_CATEGORY,
        owner: info.owner,
        favAt: existing?.favAt ?? Date.now(),
        addedAt: existing?.addedAt ?? Date.now()
      }
      update((d) => ({
        ...d,
        singingVideos: existing
          ? d.singingVideos.map((video) => (video.bvid === info.bvid ? entry : video))
          : [...d.singingVideos, entry]
      }))
      // 写回默认种子，用户更新版本后就能看到这个视频
      void window.laozheng.saveSingingVideoDefault(entry).catch(() => undefined)
      setSingingAddOpen(false)
      setSingingLink('')
      setSingingTitle('')
      setSingingCategory('')
      onNotice(`已添加「${entry.title}」`)
    } catch (err) {
      setSingingError(err instanceof Error ? err.message : '添加失败')
    } finally {
      setSingingBusy(false)
    }
  }

  const renameSinging = (title: string): void => {
    if (!singingRenameTarget) return
    const target = singingRenameTarget
    const next: SingingVideo = { ...target, title }
    update((d) => ({
      ...d,
      singingVideos: d.singingVideos.map((video) => (video.bvid === target.bvid ? next : video))
    }))
    // 默认标题同步写回种子，随下个版本发给用户
    void window.laozheng.saveSingingVideoDefault(next).catch(() => undefined)
    setSingingRenameTarget(null)
    onNotice(`已改名为「${title}」`)
  }

  const rows: ReactNode[] = []
  const render = (parentId: number | null, depth: number): void => {
    for (const list of childrenOf(parentId)) {
      const kids = childrenOf(list.id)
      const isOpen = expanded.has(list.id)
      rows.push(
        <div
          key={list.id}
          className="tree-row"
          style={{ paddingLeft: 12 + depth * 26 }}
        >
          {kids.length ? (
            <button
              className="icon-btn"
              title={isOpen ? '收起' : '展开'}
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(list.id)) next.delete(list.id)
                  else next.add(list.id)
                  return next
                })
              }
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span style={{ width: 28, flex: '0 0 28px' }} />
          )}
          <span className="tree-name">
            {depth > 0 ? '└ ' : ''}
            {list.name}
          </span>
          {list.musicList ? <span className="badge">音乐清单</span> : null}
          <span className="tree-count">
            {countItems(data, list.id, false)} 件
            {kids.length ? ` · ${kids.length} 个子清单` : ''}
          </span>
          <button className="icon-btn" title="重命名" onClick={() => setRenaming(list)}>
            <Pencil size={14} />
          </button>
          <button className="icon-btn danger" title="删除" onClick={() => setDeleting(list)}>
            <Trash2 size={14} />
          </button>
        </div>
      )
      if (kids.length && isOpen) render(list.id, depth + 1)
    }
  }
  render(null, 0)

  return (
    <div className="settings">
      <section className="settings-card">
        <h3>清单管理</h3>
        <p className="settings-hint">
          共 {data.lists.length} 个清单。带子清单的行可以逐级展开；删除清单会连同子清单与清单内关联一起移除，
          收藏条目本身会保留。
        </p>
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> 新建清单
          </button>
          <button className="btn" onClick={() => void importLists()}>
            <Upload size={15} /> 导入清单
          </button>
          <button
            className="btn"
            disabled={data.lists.length === 0}
            onClick={() => void exportLists()}
          >
            <Download size={15} /> 导出清单
          </button>
        </div>
        {data.lists.length === 0 ? (
          <div className="settings-hint">还没有清单，点「新建清单」创建一个。</div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {rows}
          </div>
        )}
      </section>

      <section className="settings-card">
        <h3>演唱管理</h3>
        <p className="settings-hint">
          共 {data.singingVideos.length} 个视频。演唱视频随版本更新给用户，用户端不能删除，只能收藏；
          {developerMode
            ? '开发者模式已开启，添加与改名会同步写回默认种子，随下个版本发布。'
            : '在设置页右上角进入开发者模式后，才能添加视频或改名。'}
        </p>
        {developerMode ? (
          <>
            <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="btn primary" onClick={() => setSingingAddOpen(true)}>
                <Plus size={15} /> 添加视频
              </button>
            </div>
            {singingTree.length ? (
              <div className="toolbar singing-filters" style={{ marginTop: 10, marginBottom: 0 }}>
                <select
                  className="select-inline"
                  value={singingLevel1}
                  title="一级分类"
                  onChange={(event) => {
                    setSingingLevel1(event.target.value)
                    setSingingLevel2('')
                    setSingingLevel3('')
                  }}
                >
                  <option value="">全部（{data.singingVideos.length}）</option>
                  {singingTree.map((node) => (
                    <option key={node.name} value={node.name}>
                      {node.name}（{node.count}）
                    </option>
                  ))}
                </select>
                {singingLevel1Node && singingLevel1Node.children.length ? (
                  <select
                    className="select-inline"
                    value={singingLevel2}
                    title="二级分类"
                    onChange={(event) => {
                      setSingingLevel2(event.target.value)
                      setSingingLevel3('')
                    }}
                  >
                    <option value="">全部（{singingLevel1Node.count}）</option>
                    {singingLevel1Node.children.map((node) => (
                      <option key={node.name} value={node.name}>
                        {node.name}（{node.count}）
                      </option>
                    ))}
                  </select>
                ) : null}
                {singingLevel2Node && singingLevel2Node.children.length ? (
                  <select
                    className="select-inline"
                    value={singingLevel3}
                    title="三级分类"
                    onChange={(event) => setSingingLevel3(event.target.value)}
                  >
                    <option value="">全部（{singingLevel2Node.count}）</option>
                    {singingLevel2Node.children.map((node) => (
                      <option key={node.name} value={node.name}>
                        {node.name}（{node.count}）
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}
            <input
              value={singingQuery}
              onChange={(event) => setSingingQuery(event.target.value)}
              placeholder="搜索要改名的视频：标题 / UP主 / 分类 / BV 号"
              style={{ marginTop: 10 }}
            />
            <div className="singing-manage-list">
              {singingFiltered.length ? (
                singingFiltered.map((video) => (
                  <div className="singing-manage-row" key={video.bvid}>
                    <span className="singing-manage-title" title={video.title}>
                      {video.title}
                    </span>
                    <span className="singing-manage-meta">{video.category}</span>
                    <button
                      className="icon-btn"
                      title="改名"
                      onClick={() => setSingingRenameTarget(video)}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="settings-hint">没有匹配的视频。</div>
              )}
            </div>
          </>
        ) : (
          <div className="settings-hint">进入开发者模式后可在这里添加视频、搜索并改名。</div>
        )}
      </section>

      {singingRenameTarget ? (
        <PromptDialog
          key={singingRenameTarget.bvid}
          title="修改演唱标题"
          initial={singingRenameTarget.title}
          confirmText="保存"
          onConfirm={renameSinging}
          onCancel={() => setSingingRenameTarget(null)}
        />
      ) : null}

      {singingAddOpen ? (
        <Modal
          title="通过 B站链接添加"
          onClose={() => {
            setSingingAddOpen(false)
            setSingingError('')
          }}
          footer={
            <>
              <button
                className="btn ghost"
                onClick={() => {
                  setSingingAddOpen(false)
                  setSingingError('')
                }}
              >
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => void submitSingingAdd()}
                disabled={singingBusy}
              >
                {singingBusy ? '解析中…' : '添加'}
              </button>
            </>
          }
        >
          <input
            value={singingLink}
            onChange={(event) => setSingingLink(event.target.value)}
            placeholder="粘贴 B站视频链接 / BV 号 / av 号，支持 b23.tv 短链"
            autoFocus
          />
          <input
            value={singingTitle}
            onChange={(event) => setSingingTitle(event.target.value)}
            placeholder="自定义标题（留空使用 B站标题）"
          />
          <input
            value={singingCategory}
            onChange={(event) => setSingingCategory(event.target.value)}
            placeholder={SINGING_MANUAL_CATEGORY}
            list="singing-settings-category-options"
          />
          <datalist id="singing-settings-category-options">
            {singingCategories.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {singingError ? <p className="singing-hint danger">{singingError}</p> : null}
          <p className="singing-hint">分类留空会放进「{SINGING_MANUAL_CATEGORY}」。</p>
        </Modal>
      ) : null}

      {creating && (
        <PromptDialog
          title="新建清单"
          placeholder="清单名称"
          confirmText="创建"
          onConfirm={createList}
          onCancel={() => setCreating(false)}
        />
      )}

      {renaming && (
        <PromptDialog
          title="重命名清单"
          initial={renaming.name}
          confirmText="保存"
          onConfirm={renameList}
          onCancel={() => setRenaming(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除清单"
          message={`确定删除清单「${deleting.name}」吗？${
            childrenOf(deleting.id).length
              ? `\n其下 ${childrenOf(deleting.id).length} 个子清单也会一并删除。`
              : ''
          }\n该清单下的 ${countItems(data, deleting.id, false)} 件条目关联会被移除（收藏条目本身保留）。`}
          confirmText="删除"
          danger
          onConfirm={deleteList}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
