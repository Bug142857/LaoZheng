import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Modal } from '../components/ui'
import {
  SK_ADAPTER_LABEL,
  SK_DEFAULT_BASE,
  inferSkAdapter,
  type SkAdapter,
  type SkMirrorOption,
  type ShuangkanSource
} from '../shared/shuangkan'
import {
  MEITU_SOURCE_TEMPLATES,
  type MeituSource,
  type MeituSourceInput,
  type MeituSourceTemplate
} from '../shared/meitu'
import {
  WALLPAPER_SOURCE_TEMPLATES,
  type WallpaperSource,
  type WallpaperSourceInput,
  type WallpaperSourceTemplate
} from '../shared/wallpaper'
import {
  ROU07_DRAMA_BASE_URL,
  ROU07_DRAMA_SOURCE_ID,
  XIFAN_DRAMA_BASE_URL,
  type DramaSource
} from '../shared/drama'
import {
  MUSIC_SOURCE_LINES,
  musicLineName,
  type MusicSource,
  type MusicSourceBackup,
  type MusicSourceLine
} from '../shared/music'
import {
  NOVEL_SOURCE_TEMPLATE_LABEL,
  NOVEL_SOURCE_TEMPLATE_OPTIONS,
  type NovelSource,
  type NovelSourceInput,
  type NovelSourceTemplate
} from '../shared/novel'
import {
  type ComicMirrorOption,
  type ComicSource,
  type ComicSourceInput,
  type ComicSourceTemplate
} from '../shared/comicSources'
import {
  TRAINER_SOURCE_TYPE_LABEL,
  type TrainerSource,
  type TrainerSourceType
} from '../shared/trainers'
import { genSourceId, parseSourceImport, type VodSourceImport, type VodSourceInput } from '../shared/vod'
import type { LiveSource } from '../shared/live'
import type { VodSource } from '../shared/types'
import { readMirrorLatency, writeMirrorLatency } from './sourceSettings/mirrorLatency'
import { runSourceTest, testMsgText, withMs } from './sourceSettings/sourceTest'
export function WallpaperSourceModal({
  source,
  onClose,
  onSave
}: {
  source: WallpaperSource | null
  onClose: () => void
  onSave: (input: WallpaperSourceInput) => void
}) {
  const [template, setTemplate] = useState<WallpaperSourceTemplate>(
    source?.template ?? 'wallspic'
  )
  const [name, setName] = useState(source?.name ?? WALLPAPER_SOURCE_TEMPLATES[0].name)
  const [baseUrl, setBaseUrl] = useState(
    source?.baseUrl ?? WALLPAPER_SOURCE_TEMPLATES[0].homepage
  )
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())
  const info = WALLPAPER_SOURCE_TEMPLATES.find((entry) => entry.id === template)

  const pickTemplate = (next: WallpaperSourceTemplate) => {
    const prev = WALLPAPER_SOURCE_TEMPLATES.find((entry) => entry.id === template)
    const target = WALLPAPER_SOURCE_TEMPLATES.find((entry) => entry.id === next)
    if (!target) return
    setTemplate(next)
    // 没改过默认名称 / 地址时跟着模板走，避免用户选错模板后还留着旧站点
    if (!name.trim() || (prev && name.trim() === prev.name)) setName(target.name)
    if (!baseUrl.trim() || (prev && baseUrl.trim() === prev.homepage)) setBaseUrl(target.homepage)
  }

  return (
    <Modal
      title={source ? '修改壁纸源' : '添加壁纸源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                ...(source ? { id: source.id } : {}),
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                template
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={info?.name ?? '壁纸源名称'}
          />
        </label>
        <label>
          站点模板
          <select
            value={template}
            onChange={(e) => pickTemplate(e.target.value as WallpaperSourceTemplate)}
          >
            {WALLPAPER_SOURCE_TEMPLATES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={info?.homepage ?? 'https://wallspic.com/cn'}
          />
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        壁纸源按站点模板解析页面；同一模板可以添加镜像地址，修改地址后建议重新测试一次。
      </p>
    </Modal>
  )
}

export function MeituSourceModal({
  source,
  onClose,
  onSave
}: {
  source: MeituSource | null
  onClose: () => void
  onSave: (input: MeituSourceInput) => void
}) {
  const [template, setTemplate] = useState<MeituSourceTemplate>(source?.template ?? 'jb9')
  const [name, setName] = useState(source?.name ?? MEITU_SOURCE_TEMPLATES[0].name)
  const [baseUrl, setBaseUrl] = useState(
    source?.baseUrl ?? MEITU_SOURCE_TEMPLATES[0].homepage
  )
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())
  const info = MEITU_SOURCE_TEMPLATES.find((entry) => entry.id === template)

  const pickTemplate = (next: MeituSourceTemplate) => {
    const prev = MEITU_SOURCE_TEMPLATES.find((entry) => entry.id === template)
    const target = MEITU_SOURCE_TEMPLATES.find((entry) => entry.id === next)
    if (!target) return
    setTemplate(next)
    // 没改过默认名称 / 地址时跟着模板走
    if (!name.trim() || (prev && name.trim() === prev.name)) setName(target.name)
    if (!baseUrl.trim() || (prev && baseUrl.trim() === prev.homepage)) setBaseUrl(target.homepage)
  }

  return (
    <Modal
      title={source ? '修改套图源' : '添加套图源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                ...(source ? { id: source.id } : {}),
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                template
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={info?.name ?? '套图源名称'}
          />
        </label>
        <label>
          站点模板
          <select
            value={template}
            onChange={(e) => pickTemplate(e.target.value as MeituSourceTemplate)}
          >
            {MEITU_SOURCE_TEMPLATES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={info?.homepage ?? 'https://www.jb9.es'}
          />
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        魅影画廊建议填入口地址 https://www.jb9.es（会自动选择可用线路），也可以直接填镜像站；雪月映画填 https://taoo.xyz。修改地址后建议重新测试一次。
      </p>
    </Modal>
  )
}

export function ShuangkanSourceModal({
  source,
  onClose,
  onSave
}: {
  source: ShuangkanSource | null
  onClose: () => void
  onSave: (input: { id?: string; name: string; baseUrl: string; adapter?: SkAdapter }) => void
}) {
  const [name, setName] = useState(source?.name ?? '肉视频')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? SK_DEFAULT_BASE)
  // 优选地址按源类型查询；从下拉里选中镜像时一并保存，避免 x123 / xv123 这类短域名推断错站点
  const [adapter] = useState<SkAdapter>(
    source?.adapter ?? inferSkAdapter(source?.baseUrl ?? SK_DEFAULT_BASE)
  )
  const [pickedAdapter, setPickedAdapter] = useState<SkAdapter | null>(null)
  const [mirrors, setMirrors] = useState<SkMirrorOption[] | null>(null)
  const [mirrorMeasured, setMirrorMeasured] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** measure=false 优先用上次测速缓存；点刷新按钮才 measure=true 重新测速并写回缓存 */
  const loadMirrors = useCallback(
    async (measure = false) => {
      const cacheKey = `sk:${adapter}`
      const cached = measure ? null : readMirrorLatency(cacheKey)
      if (cached) {
        setMirrors(cached.mirrors)
        setMirrorMeasured(true)
        setMirrorError(null)
        setMirrorLoading(false)
        return
      }
      setMirrorLoading(true)
      setMirrorError(null)
      try {
        const res = await window.laozheng.shuangkanMirrors(adapter, measure)
        setMirrors(res.mirrors ?? [])
        setMirrorMeasured(!!res.measured)
        if (!res.ok) {
          setMirrorError(res.error ?? '读取导航站优选地址失败')
        } else if (measure) {
          writeMirrorLatency(cacheKey, res.mirrors)
        }
      } catch (err) {
        setMirrorError((err as Error).message || '读取导航站优选地址失败')
        if (!measure) {
          setMirrors([])
          setMirrorMeasured(false)
        }
      } finally {
        setMirrorLoading(false)
      }
    },
    [adapter]
  )

  useEffect(() => {
    void loadMirrors(false)
  }, [loadMirrors])

  const current = baseUrl.trim().replace(/\/+$/, '')
  const selected = (mirrors ?? []).some((entry) => entry.url === current) ? current : ''

  return (
    <Modal
      title={source ? '修改皇片源' : '添加皇片源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                ...(source ? { id: source.id } : {}),
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                ...(pickedAdapter ? { adapter: pickedAdapter } : {})
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="肉视频" />
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              setPickedAdapter(null)
            }}
            placeholder={SK_DEFAULT_BASE}
          />
        </label>
        <label>
          优选地址（{SK_ADAPTER_LABEL[adapter]} · 延迟）
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              value={selected}
              disabled={mirrorLoading || !(mirrors ?? []).length}
              onChange={(event) => {
                const url = event.target.value
                if (!url) return
                setBaseUrl(url)
                setPickedAdapter(adapter)
              }}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">
                {mirrorLoading
                  ? '正在读取…'
                  : (mirrors ?? []).length
                    ? mirrorMeasured
                      ? `选择线路（共 ${(mirrors ?? []).length} 条，按延迟排序）`
                      : `选择线路（共 ${(mirrors ?? []).length} 条，点刷新测速）`
                    : '暂无线路'}
              </option>
              {(mirrors ?? []).map((entry) => (
                <option key={entry.url} value={entry.url}>
                  {entry.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                  {mirrorMeasured
                    ? ` · ${entry.ms != null ? `${entry.ms}ms` : '超时'}`
                    : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              title="测速"
              disabled={mirrorLoading || !(mirrors ?? []).length}
              onClick={() => void loadMirrors(true)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {mirrorError ? `优选地址读取失败：${mirrorError}。` : ''}
        选择线路时不会自动测速，点右侧刷新按钮才逐个测延迟；地址失效时仍会自动到导航站换址。
      </p>
    </Modal>
  )
}

export function SourceEditModal({
  source,
  onClose,
  onSave
}: {
  source: VodSource | null
  onClose: () => void
  onSave: (input: VodSourceInput) => void
}) {
  const [name, setName] = useState(source?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? '')
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  return (
    <Modal
      title={source ? '编辑源' : '添加源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: source?.id ?? genSourceId(baseUrl.trim()),
                name: name.trim(),
                baseUrl: baseUrl.trim()
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：非凡资源" />
        </label>
        <label>
          接口地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://example.com/api.php/provide/vod"
          />
        </label>
      </div>
    </Modal>
  )
}

export function DramaSourceModal({
  source,
  onClose,
  onSave
}: {
  source: DramaSource | null
  onClose: () => void
  onSave: (input: VodSourceInput) => void
}) {
  const rou07 = source?.id === ROU07_DRAMA_SOURCE_ID
  const [name, setName] = useState(source?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(
    source?.baseUrl ??
      (source?.builtin ? (rou07 ? ROU07_DRAMA_BASE_URL : XIFAN_DRAMA_BASE_URL) : '')
  )
  // 肉视频短剧与皇片里的肉视频是同一个站点：复用导航站优选地址（按延迟选线路）
  const [mirrors, setMirrors] = useState<SkMirrorOption[] | null>(null)
  const [mirrorMeasured, setMirrorMeasured] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** measure=false 优先用上次测速缓存；点刷新按钮才 measure=true 重新测速并写回缓存 */
  const loadMirrors = useCallback(
    async (measure = false) => {
      if (!rou07) return
      const cacheKey = `sk:${ROU07_DRAMA_SOURCE_ID}`
      const cached = measure ? null : readMirrorLatency(cacheKey)
      if (cached) {
        setMirrors(cached.mirrors)
        setMirrorMeasured(true)
        setMirrorError(null)
        setMirrorLoading(false)
        return
      }
      setMirrorLoading(true)
      setMirrorError(null)
      try {
        const res = await window.laozheng.shuangkanMirrors(ROU07_DRAMA_SOURCE_ID, measure)
        setMirrors(res.mirrors ?? [])
        setMirrorMeasured(!!res.measured)
        if (!res.ok) {
          setMirrorError(res.error ?? '读取导航站优选地址失败')
        } else if (measure) {
          writeMirrorLatency(cacheKey, res.mirrors)
        }
      } catch (err) {
        setMirrorError((err as Error).message || '读取导航站优选地址失败')
        if (!measure) {
          setMirrors([])
          setMirrorMeasured(false)
        }
      } finally {
        setMirrorLoading(false)
      }
    },
    [rou07]
  )

  useEffect(() => {
    void loadMirrors(false)
  }, [loadMirrors])

  const current = baseUrl.trim().replace(/\/+$/, '')
  const selected = (mirrors ?? []).some((entry) => entry.url === current) ? current : ''

  return (
    <Modal
      title={source ? '编辑短剧源' : '添加短剧源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: source?.id ?? '',
                name: name.trim(),
                baseUrl: baseUrl.trim()
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：某短剧采集站" />
        </label>
        <label>
          接口地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://example.com/api.php/provide/vod"
          />
        </label>
        {rou07 ? (
          <label>
            优选地址（肉视频 · 延迟）
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={selected}
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onChange={(event) => {
                  const url = event.target.value
                  if (url) setBaseUrl(url)
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">
                  {mirrorLoading
                    ? '正在读取…'
                    : (mirrors ?? []).length
                      ? mirrorMeasured
                        ? `选择线路（共 ${(mirrors ?? []).length} 条，按延迟排序）`
                        : `选择线路（共 ${(mirrors ?? []).length} 条，点刷新测速）`
                      : '暂无线路'}
                </option>
                {(mirrors ?? []).map((entry) => (
                  <option key={entry.url} value={entry.url}>
                    {entry.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                    {mirrorMeasured
                      ? ` · ${entry.ms != null ? `${entry.ms}ms` : '超时'}`
                      : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                title="测速"
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onClick={() => void loadMirrors(true)}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </label>
        ) : null}
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {rou07
          ? `${mirrorError ? `优选地址读取失败：${mirrorError}。` : ''}肉视频短剧与皇片里的肉视频是同一个站点；选线路时不会自动测速，点右侧刷新按钮才逐个测延迟。`
          : source?.builtin
            ? '西饭短剧默认使用官方接口地址，也可以改成镜像地址。'
            : '短剧源使用苹果CMS V10 接口；西饭短剧不需要在这里添加。'}
      </p>
    </Modal>
  )
}

export function NovelSourceModal({
  source,
  onClose,
  onSave
}: {
  source: NovelSource | null
  onClose: () => void
  onSave: (input: NovelSourceInput) => void
}) {
  const [name, setName] = useState(source?.name ?? '蚂蚁文学镜像')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? '')
  const [template, setTemplate] = useState<NovelSourceTemplate>(source?.template ?? 'mayi')
  // 哔咔小说与漫画里的哔咔漫画是同一个站点：复用漫画源的 /go-home 优选地址
  const [mirrors, setMirrors] = useState<ComicMirrorOption[] | null>(null)
  const [mirrorMeasured, setMirrorMeasured] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** measure=false 优先用上次测速缓存；点刷新按钮才 measure=true 重新测速并写回缓存 */
  const loadMirrors = useCallback(
    async (measure = false) => {
      if (template !== 'bikahub') return
      const cacheKey = 'comic:bikahub'
      const cached = measure ? null : readMirrorLatency(cacheKey)
      if (cached) {
        setMirrors(cached.mirrors)
        setMirrorMeasured(true)
        setMirrorError(null)
        setMirrorLoading(false)
        return
      }
      setMirrorLoading(true)
      setMirrorError(null)
      try {
        const res = await window.laozheng.comicMirrors('bikahub', measure)
        setMirrors(res.mirrors ?? [])
        setMirrorMeasured(!!res.measured)
        if (!res.ok) {
          setMirrorError(res.error ?? '读取镜像地址失败')
        } else if (measure) {
          writeMirrorLatency(cacheKey, res.mirrors)
        }
      } catch (err) {
        setMirrorError((err as Error).message || '读取镜像地址失败')
        if (!measure) {
          setMirrors([])
          setMirrorMeasured(false)
        }
      } finally {
        setMirrorLoading(false)
      }
    },
    [template]
  )

  useEffect(() => {
    void loadMirrors(false)
  }, [loadMirrors])

  const current = baseUrl.trim().replace(/\/+$/, '')
  const selected = (mirrors ?? []).some((entry) => entry.url === current) ? current : ''

  return (
    <Modal
      title={source ? '编辑小说源' : '添加小说源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: source?.id ?? '',
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                template
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：笔趣阁镜像"
          />
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://www.example.com"
          />
        </label>
        <label>
          解析模板
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as NovelSourceTemplate)}
          >
            {NOVEL_SOURCE_TEMPLATE_OPTIONS.map((key) => (
              <option key={key} value={key}>
                {NOVEL_SOURCE_TEMPLATE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        {template === 'bikahub' ? (
          <label>
            优选地址（哔咔小说 · 延迟）
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={selected}
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onChange={(event) => {
                  const url = event.target.value
                  if (url) setBaseUrl(url)
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">
                  {mirrorLoading
                    ? '正在读取…'
                    : (mirrors ?? []).length
                      ? mirrorMeasured
                        ? `选择线路（共 ${(mirrors ?? []).length} 条，按延迟排序）`
                        : `选择线路（共 ${(mirrors ?? []).length} 条，点刷新测速）`
                      : '暂无线路'}
                </option>
                {(mirrors ?? []).map((entry) => (
                  <option key={entry.url} value={entry.url}>
                    {entry.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                    {mirrorMeasured
                      ? ` · ${entry.ms != null ? `${entry.ms}ms` : '超时'}`
                      : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                title="测速"
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onClick={() => void loadMirrors(true)}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </label>
        ) : null}
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {template === 'bikahub'
          ? `${mirrorError ? `优选地址读取失败：${mirrorError}。` : ''}哔咔小说与漫画里的哔咔漫画是同一个站点；选线路时不会自动测速，点右侧刷新按钮才逐个测延迟。`
          : '小说源需要与所选模板使用同一套建站系统；填站点根地址即可。添加后可点「测试」确认能否解析推荐列表。'}
      </p>
    </Modal>
  )
}

type ComicMirrorTemplate = 'jmcomic' | 'tptoon' | 'bikahub'

const COMIC_MIRROR_LABEL: Record<ComicMirrorTemplate, string> = {
  jmcomic: '禁漫天堂',
  tptoon: '头牌漫画',
  bikahub: '哔咔漫画'
}

function hasComicMirrors(template: ComicSourceTemplate): template is ComicMirrorTemplate {
  return template === 'jmcomic' || template === 'tptoon' || template === 'bikahub'
}

export function ComicSourceModal({
  source,
  onClose,
  onSave
}: {
  source: ComicSource | null
  onClose: () => void
  onSave: (input: ComicSourceInput) => void
}) {
  const [name, setName] = useState(source?.name ?? '漫画客镜像')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? '')
  const [template, setTemplate] = useState<ComicSourceTemplate>(source?.template ?? 'yumanhua')
  const [mirrors, setMirrors] = useState<ComicMirrorOption[] | null>(null)
  const [mirrorMeasured, setMirrorMeasured] = useState(false)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** measure=false 优先用上次测速缓存；点刷新按钮才 measure=true 重新测速并写回缓存 */
  const loadMirrors = useCallback(
    async (measure = false) => {
      if (!hasComicMirrors(template)) {
        setMirrors([])
        setMirrorMeasured(false)
        setMirrorError(null)
        return
      }
      const cacheKey = `comic:${template}`
      const cached = measure ? null : readMirrorLatency(cacheKey)
      if (cached) {
        setMirrors(cached.mirrors)
        setMirrorMeasured(true)
        setMirrorError(null)
        setMirrorLoading(false)
        return
      }
      setMirrorLoading(true)
      setMirrorError(null)
      try {
        const res = await window.laozheng.comicMirrors(template, measure)
        setMirrors(res.mirrors ?? [])
        setMirrorMeasured(!!res.measured)
        if (!res.ok) {
          setMirrorError(res.error ?? '读取镜像地址失败')
        } else if (measure) {
          writeMirrorLatency(cacheKey, res.mirrors)
        }
      } catch (err) {
        setMirrorError((err as Error).message || '读取镜像地址失败')
        if (!measure) {
          setMirrors([])
          setMirrorMeasured(false)
        }
      } finally {
        setMirrorLoading(false)
      }
    },
    [template]
  )

  useEffect(() => {
    void loadMirrors(false)
  }, [loadMirrors])

  const current = baseUrl.trim().replace(/\/+$/, '')
  const selected = (mirrors ?? []).some((entry) => entry.url === current) ? current : ''

  return (
    <Modal
      title={source ? '编辑漫画源' : '添加漫画源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: source?.id ?? '',
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                template
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：漫画客镜像"
          />
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://www.yumanhua.com"
          />
        </label>
        <label>
          解析模板
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as ComicSourceTemplate)}
          >
            <option value="yumanhua">漫画客</option>
            <option value="komiic">Komiic</option>
            <option value="bikahub">哔咔漫画</option>
            <option value="tptoon">头牌漫画</option>
            <option value="jmcomic">禁漫天堂</option>
          </select>
        </label>
        {hasComicMirrors(template) ? (
          <label>
            优选地址（{COMIC_MIRROR_LABEL[template]} · 延迟）
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={selected}
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onChange={(event) => {
                  const url = event.target.value
                  if (url) setBaseUrl(url)
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">
                  {mirrorLoading
                    ? '正在读取…'
                    : (mirrors ?? []).length
                      ? mirrorMeasured
                        ? `选择线路（共 ${(mirrors ?? []).length} 条，按延迟排序）`
                        : `选择线路（共 ${(mirrors ?? []).length} 条，点刷新测速）`
                      : '暂无线路'}
                </option>
                {(mirrors ?? []).map((entry) => (
                  <option key={entry.url} value={entry.url}>
                    {entry.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                    {mirrorMeasured
                      ? ` · ${entry.ms != null ? `${entry.ms}ms` : '超时'}`
                      : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                title="测速"
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onClick={() => void loadMirrors(true)}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </label>
        ) : null}
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {mirrorError ? `镜像地址读取失败：${mirrorError}。` : ''}
        漫画客 / 哔咔镜像填站点根地址；Komiic 使用官方接口，地址保留默认即可。头牌、禁漫天堂、哔咔
        的镜像来自各自的地址发布页，打开弹窗只拉列表，点右侧刷新按钮才逐个测延迟。
      </p>
    </Modal>
  )
}

export function TrainerSourceModal({
  source,
  onClose,
  onSave
}: {
  source: TrainerSource | null
  onClose: () => void
  onSave: (input: { name: string; baseUrl: string; type: TrainerSourceType }) => void
}) {
  const [name, setName] = useState(source?.name ?? '风灵月影')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? 'https://flingtrainer.com')
  const [type, setType] = useState<TrainerSourceType>(
    source?.type && source.type !== 'megagames' ? source.type : 'fling'
  )
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  return (
    <Modal
      title={source ? '编辑补丁源' : '添加补丁源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => onSave({ name: name.trim(), baseUrl: baseUrl.trim(), type })}
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：3DM 修改器"
          />
        </label>
        <label>
          站点类型
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TrainerSourceType)}
          >
            <option value="fling">{TRAINER_SOURCE_TYPE_LABEL.fling}</option>
            <option value="3dm">{TRAINER_SOURCE_TYPE_LABEL['3dm']}</option>
            <option value="gamersky">{TRAINER_SOURCE_TYPE_LABEL.gamersky}</option>
            <option value="ali213">{TRAINER_SOURCE_TYPE_LABEL.ali213}</option>
          </select>
        </label>
        <label>
          列表页地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://flingtrainer.com"
          />
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        风灵月影填站点根地址；3DM / 游民星空 / 游侠网 填对应分区的列表页地址（修改器或存档）。
        风灵月影和三部分区支持直接下载，网盘地址会交给浏览器打开。
      </p>
    </Modal>
  )
}

function sameMusicUrl(a?: string | null, b?: string | null): boolean {
  const norm = (value?: string | null) => (value ?? '').trim().replace(/\/+$/, '').toLowerCase()
  return !!norm(a) && norm(a) === norm(b)
}

interface MusicLineStatus {
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

function backupFromLine(line: MusicSourceLine, status?: MusicLineStatus): MusicSourceBackup {
  return {
    id: line.id,
    name: line.name,
    baseUrl: line.baseUrl,
    enabled: true,
    testStatus: status?.testStatus ?? null,
    testMsg: status?.testMsg ?? null,
    testAt: status?.testAt ?? 0
  }
}

export function MusicSourceModal({
  source,
  onClose,
  onSave
}: {
  source: MusicSource | null
  onClose: () => void
  onSave: (input: {
    name: string
    baseUrl: string
    backup: MusicSourceBackup | null
    primaryStatus?: MusicLineStatus
  }) => void
}) {
  const initialBase = source?.baseUrl ?? MUSIC_SOURCE_LINES[0].baseUrl
  const [name, setName] = useState(source?.name ?? '无名闪闪音乐')
  const [baseUrl, setBaseUrl] = useState(initialBase)
  const [backup, setBackup] = useState<MusicSourceBackup | null>(() => {
    if (source?.backup) return { ...source.backup }
    const other = MUSIC_SOURCE_LINES.find((line) => !sameMusicUrl(line.baseUrl, initialBase))
    return other ? backupFromLine(other) : null
  })
  const [lineStatus, setLineStatus] = useState<Record<string, MusicLineStatus>>(() => {
    const out: Record<string, MusicLineStatus> = {}
    if (source) {
      out[source.baseUrl] = {
        testStatus: source.testStatus,
        testMsg: source.testMsg,
        testAt: source.testAt
      }
      if (source.backup) {
        out[source.backup.baseUrl] = {
          testStatus: source.backup.testStatus,
          testMsg: source.backup.testMsg,
          testAt: source.backup.testAt
        }
      }
    }
    return out
  })
  const [testing, setTesting] = useState(false)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** 备用线路下拉固定列出无名音乐 / 闪闪音乐两条；自定义备用地址也保留 */
  const backupOptions = useMemo(() => {
    const lines: MusicSourceLine[] = [...MUSIC_SOURCE_LINES]
    const extra = [source?.backup, backup].filter(Boolean) as MusicSourceBackup[]
    for (const line of extra) {
      if (!lines.some((item) => sameMusicUrl(item.baseUrl, line.baseUrl))) {
        lines.push({ id: line.id, name: line.name, baseUrl: line.baseUrl })
      }
    }
    return lines
  }, [source?.backup, backup])

  const statusOf = (url: string): MusicLineStatus =>
    lineStatus[url] ?? { testStatus: null, testMsg: null, testAt: 0 }

  const changeBaseUrl = (value: string) => {
    setBaseUrl(value)
    // 主线路改成与备用线路相同的地址时，自动把另一条线路设为备用
    if (backup && sameMusicUrl(backup.baseUrl, value)) {
      const other = MUSIC_SOURCE_LINES.find((line) => !sameMusicUrl(line.baseUrl, value))
      if (other) setBackup(backupFromLine(other, statusOf(other.baseUrl)))
    }
  }

  const pickBackup = (value: string) => {
    const line = backupOptions.find((item) => sameMusicUrl(item.baseUrl, value))
    if (!line) return
    if (sameMusicUrl(line.baseUrl, baseUrl)) {
      // 选中的是当前线路：两条线路互换，选中项作为备用
      const nextPrimary =
        backup?.baseUrl ||
        MUSIC_SOURCE_LINES.find((item) => !sameMusicUrl(item.baseUrl, line.baseUrl))?.baseUrl
      if (nextPrimary && !sameMusicUrl(nextPrimary, line.baseUrl)) {
        setBaseUrl(nextPrimary)
        setBackup(backupFromLine(line, statusOf(line.baseUrl)))
      }
      return
    }
    if (backup && sameMusicUrl(backup.baseUrl, line.baseUrl)) return
    setBackup(backupFromLine(line, statusOf(line.baseUrl)))
  }

  /** 一次测完下拉里的线路（无名音乐 + 闪闪音乐），延迟写回选项 */
  const testLines = async () => {
    if (testing) return
    setTesting(true)
    const results = await Promise.all(
      backupOptions.map(async (line) => {
        const started = Date.now()
        try {
          const { result: res, ms } = await runSourceTest(
            () =>
              window.laozheng.testMusicSource({
                id: line.id,
                name: line.name,
                baseUrl: line.baseUrl
              }),
            (result) => result.ok,
            'music'
          )
          return [
            line.baseUrl,
            {
              testStatus: res.ok ? 'ok' : 'bad',
              testMsg: withMs(res.ok ? res.message ?? '可用' : res.error ?? '测试失败', ms),
              testAt: Date.now()
            }
          ] as [string, MusicLineStatus]
        } catch (err) {
          const ms = Date.now() - started
          return [
            line.baseUrl,
            {
              testStatus: 'bad',
              testMsg: withMs((err as Error).message, ms),
              testAt: Date.now()
            }
          ] as [string, MusicLineStatus]
        }
      })
    )
    const map = Object.fromEntries(results) as Record<string, MusicLineStatus>
    setLineStatus((prev) => ({ ...prev, ...map }))
    setBackup((current) =>
      current && map[current.baseUrl] ? { ...current, ...map[current.baseUrl] } : current
    )
    setTesting(false)
  }

  const submit = () => {
    if (!valid) return
    const primaryStatus = lineStatus[baseUrl.trim().replace(/\/+$/, '')]
    onSave({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      backup: backup ? { ...backup } : null,
      ...(primaryStatus ? { primaryStatus } : {})
    })
  }

  return (
    <Modal
      title={source ? '编辑音乐源' : '添加音乐源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：无名闪闪音乐"
          />
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => changeBaseUrl(e.target.value)}
            placeholder="http://www.mvmp3.com"
          />
        </label>
        <label>
          备用线路（{backup ? backup.name : '请选择'} · 延迟）
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              value={backup?.baseUrl ?? ''}
              disabled={testing}
              onChange={(event) => pickBackup(event.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="" disabled>
                请选择备用线路
              </option>
              {backupOptions.map((line) => {
                const status = statusOf(line.baseUrl)
                return (
                  <option key={line.baseUrl} value={line.baseUrl}>
                    {line.name} · {line.baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}{' '}
                    · {testMsgText(status.testMsg)}
                  </option>
                )
              })}
            </select>
            <button
              type="button"
              className="icon-btn"
              title="测试无名音乐 / 闪闪音乐两条线路延迟"
              disabled={testing}
              onClick={() => void testLines()}
            >
              <RefreshCw size={14} className={testing ? 'spin' : ''} />
            </button>
          </div>
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {backup
          ? `当前：${musicLineName(baseUrl) || '自定义线路'}；备用：${backup.name}。优先用当前线路，失败或空结果时自动切到备用线路。`
          : '请选择一条备用线路。'}
        两条线路都来自同一套建站系统（搜索 /so.php、直链 /style/js/play.php），
        点右侧刷新按钮可分别测试延迟。
      </p>
    </Modal>
  )
}

export function ImportModal({
  title = '批量导入片源',
  hint,
  onClose,
  onImport,
  onBuiltin
}: {
  title?: string
  hint?: string
  onClose: () => void
  onImport: (inputs: VodSourceImport[]) => void
  onBuiltin?: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const doImport = () => {
    const res = parseSourceImport(text)
    if (res.error) {
      setError(res.error)
      return
    }
    onImport(res.sources)
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          {onBuiltin ? (
            <button className="btn" onClick={onBuiltin}>
              导入内置片源
            </button>
          ) : null}
          <button className="btn primary" disabled={!text.trim()} onClick={doImport}>
            导入
          </button>
        </>
      }
    >
      <p>
        {hint ??
          '支持 KVideo 订阅 JSON（数组或单对象），或每行一个「名称|接口地址」。接口地址形如 https://example.com/api.php/provide/vod。'}
      </p>
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        placeholder={'非凡资源|https://example.com/api.php/provide/vod\nhttps://another.com/api.php/provide/vod'}
      />
      {error ? <div className="result-hint">{error}</div> : null}
    </Modal>
  )
}

export function LiveSourceModal({
  title = '添加源',
  initial,
  onClose,
  onSave
}: {
  title?: string
  initial?: LiveSource
  onClose: () => void
  onSave: (name: string, url: string) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const valid = /^https?:\/\//i.test(url.trim()) || url.trim().startsWith('local://')

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave(name, url)}>
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：IPv4 直播源" />
        </label>
        <label>
          M3U 地址
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/playlist.m3u"
          />
        </label>
      </div>
    </Modal>
  )
}
