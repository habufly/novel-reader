import type { Bookmark, ChapterMeta } from '@shared/types'

interface Props {
  bookmarks: Bookmark[]
  chapters: ChapterMeta[]
  onJump: (chapterId: number, charOffset: number) => void
  onRemove: (id: string) => void
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function BookmarkList({
  bookmarks,
  chapters,
  onJump,
  onRemove
}: Props): React.JSX.Element {
  if (bookmarks.length === 0) {
    return (
      <div className="marks__empty">
        <p>還沒有書籤。</p>
        <p className="marks__emptyHint">
          閱讀時按 Ctrl+D 就會在目前位置加一個；先選取文字的話會存下選取內容。
        </p>
      </div>
    )
  }

  return (
    <ul className="marks">
      {bookmarks.map((b) => (
        <li key={b.id} className="marks__item">
          <button className="marks__main" onClick={() => onJump(b.chapterId, b.charOffset)}>
            <span className="marks__chapter">{chapters[b.chapterId]?.title ?? `第 ${b.chapterId} 章`}</span>
            <span className="marks__excerpt">{b.excerpt || '（無摘錄）'}</span>
            {b.note && <span className="marks__note">{b.note}</span>}
            <span className="marks__when">{formatWhen(b.createdAt)}</span>
          </button>
          <button
            className="marks__remove"
            onClick={() => onRemove(b.id)}
            title="刪除書籤"
            aria-label="刪除書籤"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
