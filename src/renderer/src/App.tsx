import { useState } from 'react'
import type { Book } from '@shared/types'
import Library from './views/Library'
import BookDetail from './views/BookDetail'

export default function App(): React.JSX.Element {
  const [open, setOpen] = useState<Book | null>(null)

  return (
    <div className="shell">
      <header className="shell__header">
        <h1 className="shell__title">Novel Reader</h1>
        <span className="shell__phase">Phase 1 · 匯入與解析</span>
      </header>

      <main className="shell__body">
        {open ? (
          <BookDetail book={open} onBack={() => setOpen(null)} />
        ) : (
          <Library onOpenBook={setOpen} />
        )}
      </main>
    </div>
  )
}
