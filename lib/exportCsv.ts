export function exportToCsv(filename: string, rows: Record<string, unknown>[], columns: { key: string; label: string }[]) {
  const header = columns.map(c => `"${c.label}"`).join(',')
  const body   = rows.map(row =>
    columns.map(c => {
      const val = row[c.key]
      if (val == null) return ''
      const str = String(val).replace(/"/g, '""')
      return `"${str}"`
    }).join(',')
  ).join('\n')

  const csv  = `${header}\n${body}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
