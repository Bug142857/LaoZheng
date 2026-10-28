import { HOME_MODULES, type HomeModule } from '../modules'

export function HomePage({ onOpen }: { onOpen: (module: HomeModule) => void }) {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">首页</h1>
        <span className="page-desc">模块入口与手机端一一对应，按顺序逐步补齐</span>
      </header>

      <div className="module-grid">
        {HOME_MODULES.map((m) => {
          const Icon = m.icon
          return (
            <button key={m.key} className="module-card" onClick={() => onOpen(m)}>
              <span className="module-icon">
                <Icon size={22} strokeWidth={1.8} />
              </span>
              <span style={{ minWidth: 0 }}>
                <div className="module-name">{m.title}</div>
                <div className="module-desc">{m.desc}</div>
              </span>
              <span className={`module-state ${m.ready ? 'ready' : ''}`}>
                {m.ready ? '可用' : '规划中'}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
