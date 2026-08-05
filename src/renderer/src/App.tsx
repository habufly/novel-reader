import { useEffect, useState } from 'react'
import type { Book } from '@shared/types'
import Library from './views/Library'
import Reader from './views/Reader'
import SettingsPanel from './components/SettingsPanel'
import { useSettings } from './stores/useSettings'

export default function App(): React.JSX.Element {
  const [open, setOpen] = useState<Book | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loadSettings = useSettings((s) => s.load)
  const theme = useSettings((s) => s.theme)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  // Ctrl+, 是設定的慣例快捷鍵，書櫃與閱讀畫面都能用
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const panel = settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null

  // 閱讀時把外殼標題列收起來，讓版面全部留給內文
  if (open) {
    return (
      <>
        <Reader
          book={open}
          onBack={() => setOpen(null)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {panel}
      </>
    )
  }

  return (
    <div className="shell">
      <header className="shell__header">
        <h1 className="shell__title">Novel Reader</h1>
        <span className="shell__phase">Phase 4 · 主題與字型</span>
      </header>
      <main className="shell__body">
        <Library onOpenBook={setOpen} onOpenSettings={() => setSettingsOpen(true)} />
      </main>
      {panel}
    </div>
  )
}
