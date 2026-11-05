/** Import normalizes layout only, without classifying or removing prose. */
export interface CleanupResult { lines: string[]; junkLines: number }
export function cleanup(text: string): CleanupResult {
  return {
    lines: text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
      .split('\n').map(line => line.trim()).filter(Boolean),
    junkLines: 0
  }
}
