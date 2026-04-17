'use client'
import { useState, useCallback } from 'react'

type FileStatus = 'pending' | 'uploading' | 'done' | 'error'

interface FileState {
  file:     File
  status:   FileStatus
  message?: string
  total?:   number
  pct?:     number        // 0-100
  stage?:   string
}

const ACCEPTED = ['.xlsx', '.csv', '.pdf']

export default function UpdateDBContent() {
  const [files,    setFiles]    = useState<FileState[]>([])
  const [dragging, setDragging] = useState(false)

  function addFiles(incoming: FileList | File[]) {
    const arr   = Array.from(incoming)
    const valid = arr.filter(f => ACCEPTED.some(ext => f.name.toLowerCase().endsWith(ext)))
    if (valid.length < arr.length) alert(`Only .xlsx and .csv files accepted. ${arr.length - valid.length} skipped.`)
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.file.name))
      const newOnes  = valid.filter(f => !existing.has(f.name)).map(f => ({ file: f, status: 'pending' as const }))
      return [...prev, ...newOnes]
    })
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files)
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }

  function setFileState(idx: number, updates: Partial<FileState>) {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, ...updates } : f))
  }

  const uploadFile = useCallback(async (idx: number, filesList: FileState[]) => {
    const fs = filesList[idx]
    setFileState(idx, { status: 'uploading', pct: 0, stage: 'compressing' })

    try {
      // Compress file with gzip to stay under Vercel's 4.5 MB payload limit.
      // A 4+ MB XLSX compresses to ~1-2 MB with gzip.
      let body: Blob | File = fs.file
      let encoding = ''
      if (typeof CompressionStream !== 'undefined') {
        const stream = fs.file.stream().pipeThrough(new CompressionStream('gzip'))
        body = await new Response(stream).blob()
        encoding = 'gzip'
      }

      setFileState(idx, { status: 'uploading', pct: 0, stage: 'uploading' })

      const headers: Record<string, string> = {
        'X-Filename': encodeURIComponent(fs.file.name),
      }
      if (encoding) headers['Content-Encoding'] = encoding

      const res = await fetch('/api/import', { method: 'POST', body, headers })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => 'Unknown error')
        setFileState(idx, { status: 'error', message: text.slice(0, 200) })
        return
      }

      // Read NDJSON stream
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'progress') {
              setFileState(idx, { pct: evt.pct ?? 0, stage: evt.message ?? evt.stage })
            } else if (evt.type === 'done') {
              setFileState(idx, { status: 'done', pct: 100, message: evt.message, total: evt.total })
            } else if (evt.type === 'error') {
              setFileState(idx, { status: 'error', message: evt.error })
            }
          } catch {}
        }
      }
    } catch (err) {
      setFileState(idx, { status: 'error', message: err instanceof Error ? err.message : 'Network error' })
    }
  }, [])

  async function uploadAll() {
    const current = files // capture snapshot
    const pending = current.map((f, i) => ({ f, i })).filter(x => x.f.status === 'pending')
    for (const { i } of pending) await uploadFile(i, current)
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  function fileTypeLabel(name: string): { label: string; color: string } {
    const lower = name.toLowerCase()
    if (lower.endsWith('.pdf')) return { label: 'Assignments PDF', color: 'badge-blue' }
    if (lower.includes('assignment') || lower.includes('driver_vehicle') || lower.includes('driver vehicle')) return { label: 'Assignments', color: 'badge-blue' }
    if (lower.includes('driver report') || lower.includes('driver_report')) return { label: 'Driver Report', color: 'badge-purple' }
    if (lower.endsWith('.xlsx') && lower.includes('driver')) return { label: 'Drivers', color: 'badge-gray' }
    if (lower.endsWith('.xlsx')) return { label: 'CCSI', color: 'badge-blue' }
    if (lower.includes('device')) return { label: 'Devices', color: 'badge-amber' }
    if (lower.includes('unbilled') || lower.includes('usage') || lower.includes('account')) return { label: 'Verizon', color: 'badge-green' }
    if (lower.includes('driver')) return { label: 'Driver Report', color: 'badge-purple' }
    return { label: 'CSV', color: 'badge-gray' }
  }

  const hasPending = files.some(f => f.status === 'pending')
  const allDone    = files.length > 0 && files.every(f => f.status === 'done' || f.status === 'error')

  return (
    <div>
      {/* File type guide */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { icon: '📊', name: 'CCSI.xlsx',                         desc: 'Vehicle fleet records',  color: 'var(--blue)'  },
          { icon: '📄', name: 'View_All_Devices.csv',              desc: 'MaaS360 device list',    color: 'var(--amber)' },
          { icon: '📄', name: 'account_unbilled_usage_report.csv', desc: 'Verizon usage data',     color: 'var(--green)' },
          { icon: '📊', name: 'CCSI-drivers.xlsx',                    desc: 'Driver roster + photos', color: '#9b59b6' },
          { icon: '📄', name: 'Driver Report.csv',                  desc: 'Tableau export — license, phone, address', color: '#7c3aed' },
          { icon: '📄', name: 'Vehicle Assignments.pdf',              desc: 'NTS-67 scanned driver assignments',        color: '#0891b2' },
        ].map(f => (
          <div key={f.name} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{f.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: f.color, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{f.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{f.desc}</div>
          </div>
        ))}
      </div>

      {/* Safety notice */}
      <div className="alert alert-warning" style={{ marginBottom: 20 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Import uses <strong>upsert</strong> — existing records are updated, new ones are added. <strong>Notes you have added in the portal are never overwritten.</strong> Vehicles removed from your spreadsheet are NOT deleted from the database automatically.
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onClick={() => document.getElementById('db-file-input')?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border2)'}`,
          borderRadius: 'var(--radius-lg)', padding: '40px 24px', textAlign: 'center',
          cursor: 'pointer', transition: 'all 0.15s', marginBottom: 20,
          background: dragging ? 'var(--amber-bg)' : 'var(--bg2)',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
        <div style={{ fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Drop files here or click to browse</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>Accepts .xlsx, .csv, and .pdf — file type detected automatically</div>
        <input id="db-file-input" type="file" accept=".xlsx,.csv,.pdf" multiple style={{ display: 'none' }} onChange={onFileInput} />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          {files.map((fs, i) => {
            const typeInfo = fileTypeLabel(fs.file.name)
            const isUploading = fs.status === 'uploading'
            const pct = fs.pct ?? 0
            return (
              <div key={fs.file.name} style={{
                padding: '14px 16px',
                borderBottom: i < files.length - 1 ? '1px solid var(--border)' : 'none'
              }}>
                {/* File header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{fs.file.name.endsWith('.xlsx') ? '📊' : fs.file.name.endsWith('.pdf') ? '📕' : '📄'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>{fs.file.name}</span>
                      <span className={`badge ${typeInfo.color}`}>{typeInfo.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {(fs.file.size / 1024).toFixed(0)} KB
                      {fs.message && (
                        <span style={{ marginLeft: 8, color: fs.status === 'done' ? 'var(--green)' : fs.status === 'error' ? 'var(--red)' : 'var(--text3)' }}>
                          · {fs.message}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {fs.status === 'pending'   && <button className="btn-primary btn-sm" onClick={() => uploadFile(i, files)}>Upload</button>}
                    {fs.status === 'done'      && <span style={{ fontSize: 18 }}>✅</span>}
                    {fs.status === 'error'     && <span style={{ fontSize: 18 }}>❌</span>}
                    {fs.status !== 'uploading' && (
                      <button className="btn-icon btn-sm" onClick={() => removeFile(i)} title="Remove">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {isUploading && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{fs.stage ?? 'Processing…'}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{pct}%</span>
                    </div>
                    <div style={{ background: 'var(--bg4)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: 4,
                        background: pct === 100 ? 'var(--green)' : 'var(--accent)',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {hasPending && (
        <button className="btn-primary" onClick={uploadAll}>
          Upload All ({files.filter(f => f.status === 'pending').length} file{files.filter(f => f.status === 'pending').length !== 1 ? 's' : ''})
        </button>
      )}

      {allDone && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          Import complete — navigate to Vehicles, Devices, or Lines to verify your data.
        </div>
      )}
    </div>
  )
}
