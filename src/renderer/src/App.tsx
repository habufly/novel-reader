import { useEffect, useState } from 'react'
import type { Book } from '@shared/types'
import Library from './views/Library'
import Reader from './views/Reader'
import { useSettings } from './stores/useSettings'

export default function App(): React.JSX.Element {
  const [open, setOpen] = useState<Book | null>(null)
  const loadSettings = useSettings((s) => s.load)
  const theme = useSettings((s) => s.theme)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  // 閱讀時把外殼標題列收起來，讓版面全部留給內文
  if (open) return <Reader book={open} onBack={() => setOpen(null)} />

  return (
    <div className="shell">
      <header className="shell__header">
        <h1 className="shell__title">Novel Reader</h1>
        <span className="shell__phase">Phase 2 · 閱讀器核心</span>
      </header>
      <main className="shell__body">
        <Library onOpenBook={setOpen} />
      </main>
    </div>
  )
}
