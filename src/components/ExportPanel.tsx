'use client'

import { useState, useEffect } from 'react'
import type { RefObject } from 'react'
import type { SceneCommands } from './TerrainApp'
import styles from './ExportPanel.module.css'

const STYLES = [
  { id: 'realistic', label: '📸 Realista',  prompt: 'Apply photorealistic textures and lighting to this architectural site plan render. ONLY stylize the elements that already exist in this image — do NOT add, remove or move any object, plant, tree, structure or element. Keep the exact same layout, positions and proportions. Replace the flat 3D colors with realistic materials: real grass texture where there is grass, real wood/tile/concrete where there are structures, natural tree canopy where there are trees. Use natural aerial daylight lighting and soft shadows.' },
  { id: 'cartoon',   label: '🎨 Cartoon',   prompt: 'Apply a colorful cartoon/illustrated style to this architectural site plan render. ONLY stylize the elements that already exist in this image — do NOT add, remove or move any object, plant, tree, structure or element. Keep the exact same layout, positions and proportions. Use vibrant flat colors, thick outlines and a top-down illustrated look.' },
  { id: '3d',        label: '🏗️ 3D Render', prompt: 'Apply a professional 3D architectural visualization style to this site plan render. ONLY stylize the elements that already exist in this image — do NOT add, remove or move any object, plant, tree, structure or element. Keep the exact same layout, positions and proportions. Enhance with high-quality materials, dramatic lighting and depth, maintaining the aerial perspective.' },
  { id: 'lowpoly',   label: '💎 Low Poly',  prompt: 'Apply a low-poly geometric illustration style to this architectural site plan render. ONLY stylize the elements that already exist in this image — do NOT add, remove or move any object, plant, tree, structure or element. Keep the exact same layout, positions and proportions. Use flat shading, geometric facets and a clean minimalist aesthetic.' },
]

// Models known to support image output — user can still override
const MODEL_CANDIDATES = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-2.0-flash-exp',
]

interface ExportPanelProps {
  commands: RefObject<SceneCommands | null>
  onClose: () => void
}

export default function ExportPanel({ commands, onClose }: ExportPanelProps) {
  const [apiKey, setApiKey]       = useState('')
  const [modelName, setModelName] = useState('gemini-2.5-flash-image')
  const [loading, setLoading]     = useState(false)
  const [listingModels, setListingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [resultImg, setResultImg] = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [shareUrl, setShareUrl]   = useState<string | null>(null)
  const [copied, setCopied]       = useState(false)
  const [activeStyle, setActiveStyle] = useState<string | null>(null)

  useEffect(() => {
    const k = localStorage.getItem('gemini-key')
    const m = localStorage.getItem('gemini-model')
    if (k) setApiKey(k)
    if (m) setModelName(m)
  }, [])

  function saveKey(k: string) {
    setApiKey(k); localStorage.setItem('gemini-key', k)
  }
  function saveModel(m: string) {
    setModelName(m); localStorage.setItem('gemini-model', m)
  }

  function downloadImg(fmt: 'png' | 'jpeg') {
    const url = commands.current?.getCanvasDataURL(fmt)
    if (!url) return
    const a = document.createElement('a')
    a.href = url; a.download = `planta.${fmt}`; a.click()
  }

  function downloadBlob(dataUrl: string, filename: string) {
    const a = document.createElement('a')
    a.href = dataUrl; a.download = filename; a.click()
  }

  function generateShareLink() {
    const data = commands.current?.getSceneData()
    if (!data) return
    try {
      const hash = btoa(encodeURIComponent(JSON.stringify(data)))
      const url = `${window.location.origin}${window.location.pathname}#share=${hash}`
      setShareUrl(url)
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2500)
      })
    } catch {
      setError('Erro ao gerar link')
    }
  }

  async function listModels() {
    if (!apiKey.trim()) { setError('Insira sua API Key primeiro'); return }
    setListingModels(true); setError(null); setAvailableModels([])
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
      const all: string[] = (json.models ?? [])
        .filter((m: { supportedGenerationMethods?: string[] }) =>
          m.supportedGenerationMethods?.includes('generateContent')
        )
        .map((m: { name: string }) => m.name.replace('models/', ''))
      // Put image-capable models first
      const names = [
        ...all.filter(n => n.includes('image')),
        ...all.filter(n => !n.includes('image')),
      ]
      setAvailableModels(names)
      // Auto-select first image model if available
      const firstImg = names.find(n => n.includes('image'))
      if (firstImg && !localStorage.getItem('gemini-model')) saveModel(firstImg)
      if (names.length === 0) setError('Nenhum modelo disponível para generateContent com essa chave.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao listar modelos')
    } finally {
      setListingModels(false)
    }
  }

  async function runGemini(style: typeof STYLES[0]) {
    if (!apiKey.trim()) { setError('Insira sua Gemini API Key'); return }
    if (!modelName.trim()) { setError('Selecione ou digite um modelo'); return }
    setLoading(true); setError(null); setResultImg(null); setActiveStyle(style.id)
    try {
      const imgData = commands.current?.getCanvasDataURL('jpeg')
      if (!imgData) throw new Error('Não foi possível capturar a cena')
      const base64 = imgData.split(',')[1]
      console.log(`[Gemini] imagem: ${(base64.length / 1024).toFixed(0)} KB (base64 JPEG)`)

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName.trim()}:generateContent?key=${apiKey.trim()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: style.prompt },
              { inline_data: { mime_type: 'image/jpeg', data: base64 } },
            ]}],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`)

      const candidate = json.candidates?.[0]
      const parts: Array<{
        inline_data?: { data: string; mime_type?: string }
        inlineData?:  { data: string; mimeType?:  string }
        text?: string
      }> = candidate?.content?.parts ?? []
      const imgPart = parts.find(p => p.inline_data?.data || p.inlineData?.data)
      if (imgPart) {
        const id   = imgPart.inline_data ?? imgPart.inlineData!
        const mime = (imgPart.inline_data?.mime_type ?? imgPart.inlineData?.mimeType) ?? 'image/jpeg'
        setResultImg(`data:${mime};base64,${id.data}`)
      } else {
        // Build a detailed debug message
        const textMsg = parts.find(p => p.text)?.text
        const finishReason = candidate?.finishReason ?? 'desconhecido'
        const blockReason = json.promptFeedback?.blockReason
        const safetyRatings = candidate?.safetyRatings?.map(
          (r: { category: string; probability: string }) => `${r.category}: ${r.probability}`
        ).join(', ')
        console.warn('[Gemini] no image in response:', JSON.stringify(json).slice(0, 800))
        const debug = [
          `finishReason: ${finishReason}`,
          `parts: ${parts.length}`,
          blockReason ? `blockReason: ${blockReason}` : null,
          safetyRatings ? `safety: ${safetyRatings}` : null,
          textMsg ? `resposta: "${textMsg.slice(0, 200)}"` : null,
          parts.length > 0 && !textMsg ? `part[0]: ${JSON.stringify(parts[0]).slice(0, 150)}` : null,
          parts.length === 0 ? '→ modelo não suporta geração de imagem (tente gemini-2.0-flash-preview-image-generation)' : null,
        ].filter(Boolean).join(' | ')
        throw new Error(debug || JSON.stringify(json).slice(0, 300))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span>🖼️ Exportar / Compartilhar</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Download scene */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Baixar cena atual</div>
          <div className={styles.btnRow}>
            <button className={styles.actionBtn} onClick={() => downloadImg('png')}>📥 PNG</button>
            <button className={styles.actionBtn} onClick={() => downloadImg('jpeg')}>📥 JPG</button>
            <button className={styles.actionBtn} onClick={() => window.print()}>🖨️ PDF (imprimir)</button>
          </div>
        </div>

        {/* Share link */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Link compartilhável</div>
          <button className={styles.actionBtn} onClick={generateShareLink}>🔗 Gerar link</button>
          {shareUrl && (
            <div className={styles.shareBox}>
              <input className={styles.shareInput} value={shareUrl} readOnly onClick={e => (e.target as HTMLInputElement).select()} />
              <span className={styles.copiedHint}>{copied ? '✅ Copiado para área de transferência!' : 'Clique para selecionar'}</span>
            </div>
          )}
        </div>

        {/* Gemini AI */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>✨ Gemini AI — Gerar versão estilizada</div>

          <input
            className={styles.keyInput}
            type="password"
            placeholder="Cole sua Gemini API Key aqui"
            value={apiKey}
            onChange={e => saveKey(e.target.value)}
          />

          {/* Model selection */}
          <div className={styles.modelRow}>
            <input
              className={styles.modelInput}
              value={modelName}
              onChange={e => saveModel(e.target.value)}
              placeholder="Nome do modelo"
              list="model-suggestions"
            />
            <datalist id="model-suggestions">
              {[...MODEL_CANDIDATES, ...availableModels].filter((v, i, a) => a.indexOf(v) === i).map(m => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button
              className={styles.listModelsBtn}
              onClick={listModels}
              disabled={listingModels}
              title="Buscar modelos disponíveis com sua chave"
            >
              {listingModels ? '⏳' : '🔍'}
            </button>
          </div>

          {availableModels.length > 0 && (
            <div className={styles.modelListWrap}>
              <div className={styles.modelListLabel}>Modelos disponíveis (clique para selecionar):</div>
              <div className={styles.modelList}>
                {availableModels.map(m => (
                  <button
                    key={m}
                    className={`${styles.modelChip} ${modelName === m ? styles.modelChipActive : ''} ${m.includes('image') ? styles.modelChipImage : ''}`}
                    onClick={() => saveModel(m)}
                    title={m.includes('image') ? '✨ Suporta geração de imagem' : ''}
                  >
                    {m.includes('image') ? '🖼️ ' : ''}{m}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.styleGrid}>
            {STYLES.map(s => (
              <button
                key={s.id}
                className={`${styles.styleBtn} ${activeStyle === s.id && loading ? styles.styleBtnLoading : ''}`}
                onClick={() => runGemini(s)}
                disabled={loading}
              >
                {s.label}
              </button>
            ))}
          </div>

          {loading && <div className={styles.loadingMsg}>⏳ Gerando com Gemini AI…</div>}
          {error && <div className={styles.errorMsg}>⚠️ {error}</div>}
          {resultImg && (
            <div className={styles.resultArea}>
              <img src={resultImg} className={styles.resultImg} alt="Resultado Gemini" />
              <button className={styles.actionBtn} onClick={() => downloadBlob(resultImg, 'planta-gemini.png')}>
                📥 Baixar resultado
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
