import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { Book, BookIndex } from '@shared/types'
import { dataPath, readJson, writeJson } from './jsonStore'

interface LibraryFile {
  books: Book[]
}

const libraryFile = (): string => dataPath('books.json')

export const bookDir = (id: string): string => dataPath('books', id)
export const contentFile = (id: string): string => dataPath('books', id, 'content.txt')
export const indexFile = (id: string): string => dataPath('books', id, 'index.json')
export const progressFile = (id: string): string => dataPath('books', id, 'progress.json')

export function newBookId(): string {
  return `b_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function listBooks(): Book[] {
  return readJson<LibraryFile>(libraryFile(), { books: [] }).books
}

export function saveBook(book: Book): void {
  const books = listBooks()
  const at = books.findIndex((b) => b.id === book.id)
  if (at >= 0) books[at] = book
  else books.push(book)
  writeJson(libraryFile(), { books })
}

export function getBook(id: string): Book | undefined {
  return listBooks().find((b) => b.id === id)
}

export async function removeBook(id: string): Promise<void> {
  writeJson(libraryFile(), { books: listBooks().filter((b) => b.id !== id) })
  // 只刪我們自己產生的正規化副本，使用者的原始檔完全不動
  await rm(bookDir(id), { recursive: true, force: true })
}

export function readIndex(id: string): BookIndex {
  return readJson<BookIndex>(indexFile(id), { chapters: [] })
}

export function writeIndex(id: string, index: BookIndex): void {
  writeJson(indexFile(id), index)
}
