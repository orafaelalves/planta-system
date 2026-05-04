'use client'

import { memo, useState, useCallback, useEffect } from 'react'
import type { RefObject } from 'react'
import type {
  ActiveTab, ZoneType, TerrainStats, SelectedZoneInfo, SelectedElementInfo, SceneCommands, ProjMeta,
} from './TerrainApp'
import {
  idbSaveProject, idbListProjects, idbLoadProject, idbDeleteProject,
} from './TerrainApp'
import styles from './TerrainApp.module.css'

interface SidebarProps {
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
  navMode: boolean
  onNavModeToggle: () => void
  terrainStats: TerrainStats | null
  zoneTool: ZoneType | null
  selectedZone: SelectedZoneInfo | null
  currentTool: string | null
  toolDims: { w: number; d: number } | null
  onToolDimsChange: (dims: { w: number; d: number }) => void
  selectedElement: SelectedElementInfo | null
  commands: RefObject<SceneCommands | null>
  onExport: () => void
}

const ZONE_TYPES: { type: ZoneType; label: string; color: string }[] = [
  { type: 'mata',  label: 'Mata nativa', color: '#1a5a00' },
  { type: 'limpo', label: 'Área limpa',  color: '#4aaa1a' },
  { type: 'agua',  label: 'Lago / Água', color: '#005f8a' },
]

const ZONE_NAME: Record<ZoneType, string> = { mata: 'Mata nativa', limpo: 'Área limpa', agua: 'Lago/Água' }

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const Sidebar = memo(function Sidebar({
  activeTab, onTabChange,
  terrainStats, zoneTool, selectedZone, currentTool,
  toolDims, onToolDimsChange,
  selectedElement, commands, onExport,
}: SidebarProps) {
  const [rw, setRw] = useState(25)
  const [rd, setRd] = useState(40)

  // ── Project management state ──────────────────────────────────────────────
  const [projName, setProjName] = useState('Novo projeto')
  const [projId, setProjId]   = useState<string | null>(null)
  const [showProjects, setShowProjects] = useState(false)
  const [savedList, setSavedList] = useState<ProjMeta[]>([])
  const [saving, setSaving] = useState(false)

  const cmd = () => commands.current!

  const refreshList = useCallback(async () => {
    const list = await idbListProjects()
    setSavedList(list)
  }, [])

  useEffect(() => { if (showProjects) refreshList() }, [showProjects, refreshList])

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      const id = projId ?? Date.now().toString(36)
      const name = projName.trim() || 'Sem nome'
      await idbSaveProject(id, name, cmd().getSceneData())
      setProjId(id); setProjName(name)
      await refreshList()
      setShowProjects(true)
    } finally { setSaving(false) }
  }, [projId, projName, saving, refreshList]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoad = useCallback(async (id: string, name: string) => {
    const data = await idbLoadProject(id)
    if (!data) return
    cmd().restoreSceneData(data)
    setProjId(id); setProjName(name)
    setShowProjects(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await idbDeleteProject(id)
    if (id === projId) setProjId(null)
    await refreshList()
  }, [projId, refreshList])

  const handleNewProject = useCallback(() => {
    setProjName('Novo projeto'); setProjId(null)
    setShowProjects(false)
  }, [])

  // ── Tab Terrain ──────────────────────────────────────────────────────────
  const TerrainTab = () => (
    <>
      <div className={styles.stitle}>Criar retângulo base</div>
      <div className={styles.inpRow}>
        <div>
          <label className={styles.inpLabel}>Largura (m)</label>
          <input
            type="number" value={rw} min={1} max={500}
            onChange={e => setRw(parseFloat(e.target.value) || 1)}
          />
        </div>
        <div>
          <label className={styles.inpLabel}>Profund. (m)</label>
          <input
            type="number" value={rd} min={1} max={500}
            onChange={e => setRd(parseFloat(e.target.value) || 1)}
          />
        </div>
      </div>
      <button className={styles.btn} onClick={() => cmd().setupRect(rw, rd)}>
        <span className={styles.ico}>📐</span>Criar retângulo
      </button>

      <div className={styles.sep} />
      <div className={styles.stitle}>Editar contorno</div>
      <div className={styles.info} style={{ fontSize: 10, color: '#475569', lineHeight: 1.75 }}>
        • Arraste qualquer ponto ◉ para mover<br />
        • Clique no terreno para adicionar ponto<br />
        • Clique próximo ao 1° ponto para fechar<br />
        • Duplo-clique fecha o terreno
      </div>
      <button className={styles.btn} onClick={() => cmd().closeTerrain()}>
        <span className={styles.ico}>✅</span>Fechar terreno
      </button>
      <button className={styles.btn} onClick={() => cmd().undoPoint()}>
        <span className={styles.ico}>↩️</span>Desfazer ponto
      </button>
      <button className={`${styles.btn} ${styles.red}`} onClick={() => cmd().resetTerrain()}>
        <span className={styles.ico}>🔄</span>Reiniciar tudo
      </button>

      <div className={styles.sep} />
      <TerrainStats stats={terrainStats} />
    </>
  )

  // ── Tab Zones ────────────────────────────────────────────────────────────
  const ZonesTab = () => (
    <>
      <div className={styles.info} style={{ fontSize: 10, color: '#475569', lineHeight: 1.75 }}>
        Selecione um tipo e arraste para criar uma zona. Clique numa zona para selecionar e editar os cantos.
      </div>
      <div className={styles.stitle}>Tipo de zona</div>

      {ZONE_TYPES.map(({ type, label, color }) => (
        <button
          key={type}
          className={`${styles.zonePill} ${zoneTool === type ? styles.active : ''}`}
          onClick={() => cmd().setZoneTool(zoneTool === type ? null : type)}
        >
          <div className={styles.zoneDot} style={{ background: color }} />
          {label}
        </button>
      ))}

      <div className={styles.sep} />

      {selectedZone && (
        <>
          <div className={styles.stitle}>Zona selecionada</div>
          <div className={styles.info}>
            {ZONE_NAME[selectedZone.type]}<br />
            Dimensão: {selectedZone.width}×{selectedZone.depth} m<br />
            Área: {selectedZone.area} m²
          </div>
          <button className={`${styles.btn} ${styles.red}`} onClick={() => cmd().deleteSelectedZone()}>
            <span className={styles.ico}>🗑️</span>Remover zona
          </button>
        </>
      )}

      <button className={styles.btn} onClick={() => cmd().clearZones()}>
        <span className={styles.ico}>🔄</span>Limpar todas as zonas
      </button>
      <div className={styles.info} style={{ fontSize: 10, color: '#475569', marginTop: 4, lineHeight: 1.7 }}>
        Arraste um canto laranja para redimensionar. ESC = deselecionar.
      </div>
    </>
  )

  // ── Tab Elements ─────────────────────────────────────────────────────────
  const ElementsTab = () => {
    const houses: { id: string; ico: string; label: string }[] = [
      { id: 'house-alv',       ico: '🏠', label: 'Alvenaria moderna'  },
      { id: 'house-chale',     ico: '🏡', label: 'Chalé de madeira'   },
      { id: 'house-container', ico: '📦', label: 'Casa container'     },
      { id: 'house-trad',      ico: '🏘️', label: 'Casa térrea trad.'  },
    ]
    const nature: { id: string; ico: string; label: string }[] = [
      { id: 'tree',    ico: '🌳', label: 'Árvore'     },
      { id: 'palm',    ico: '🌴', label: 'Palmeira'   },
      { id: 'orchard', ico: '🍎', label: 'Frutífera'  },
      { id: 'garden',  ico: '🌺', label: 'Jardim'     },
      { id: 'grass',   ico: '🌿', label: 'Grama'      },
      { id: 'rock',    ico: '🪨', label: 'Pedra'      },
      { id: 'gravel',  ico: '⬜', label: 'Cascalho'   },
      { id: 'hedge',   ico: '🌲', label: 'Sebe'       },
      { id: 'bamboo',  ico: '🎋', label: 'Bambu'      },
      { id: 'cactus',  ico: '🌵', label: 'Cacto'      },
    ]
    const soils: { id: string; ico: string; label: string }[] = [
      { id: 'soil-red',   ico: '🟫', label: 'Terra Vermelha' },
      { id: 'soil-dark',  ico: '⬛', label: 'Terra Escura'   },
      { id: 'soil-light', ico: '🟨', label: 'Terra Clara'    },
    ]
    const structs: { id: string; ico: string; label: string }[] = [
      { id: 'shed',       ico: '🏗️', label: 'Galpão'       },
      { id: 'pool',       ico: '🏊', label: 'Piscina'       },
      { id: 'fence',      ico: '🪵', label: 'Cerca'         },
      { id: 'path',       ico: '🛤️', label: 'Caminho'      },
      { id: 'tank',       ico: '🗄️', label: "Caixa d'água" },
      { id: 'wall',       ico: '🧱', label: 'Muro'          },
      { id: 'pergola',    ico: '🏛️', label: 'Pérgola'      },
      { id: 'greenhouse', ico: '🌱', label: 'Estufa'        },
      { id: 'well',       ico: '⚗️', label: 'Poço'          },
      { id: 'firepit',    ico: '🔥', label: 'Churrasqueira' },
      { id: 'steps',      ico: '🪜', label: 'Escada'        },
      { id: 'parking',    ico: '🅿️', label: 'Vaga'          },
    ]

    const ToolBtn = ({ id, ico, label }: { id: string; ico: string; label: string }) => (
      <button
        className={`${styles.btn} ${currentTool === id ? styles.active : ''}`}
        onClick={() => cmd().setCurrentTool(currentTool === id ? null : id)}
      >
        <span className={styles.ico}>{ico}</span>{label}
      </button>
    )

    return (
      <>
        {/* Selected element panel */}
        {selectedElement && !currentTool && (
          <>
            <div className={styles.selectedElPanel}>
              <div className={styles.selectedElTitle}>✅ {selectedElement.label}</div>
              <div className={styles.inpRow}>
                <div>
                  <label className={styles.inpLabel}>Rotação (°)</label>
                  <input
                    type="number" value={selectedElement.ryDeg} min={-360} max={360} step={5}
                    onChange={e => cmd().updateSelectedElement(parseFloat(e.target.value) || 0, selectedElement.sx, selectedElement.sz)}
                  />
                </div>
                <div>
                  <label className={styles.inpLabel}>Escala X</label>
                  <input
                    type="number" value={selectedElement.sx} min={0.1} max={20} step={0.1}
                    onChange={e => cmd().updateSelectedElement(selectedElement.ryDeg, parseFloat(e.target.value) || 0.1, selectedElement.sz)}
                  />
                </div>
              </div>
              <div className={styles.inpRow}>
                <div>
                  <label className={styles.inpLabel}>Escala Z</label>
                  <input
                    type="number" value={selectedElement.sz} min={0.1} max={20} step={0.1}
                    onChange={e => cmd().updateSelectedElement(selectedElement.ryDeg, selectedElement.sx, parseFloat(e.target.value) || 0.1)}
                  />
                </div>
              </div>
              <button className={`${styles.btn} ${styles.red}`} style={{ marginTop: 2 }} onClick={() => cmd().deleteSelectedElement()}>
                <span className={styles.ico}>🗑️</span>Remover selecionado
              </button>
            </div>
            <div className={styles.sep} />
          </>
        )}

        {toolDims && currentTool && currentTool !== 'delete' && (
          <>
            <div className={styles.dimBanner}>
              <span className={styles.dimBannerTitle}>📐 Dimensões</span>
              <div className={styles.inpRow}>
                <div>
                  <label className={styles.inpLabel}>Largura (m)</label>
                  <input
                    type="number" value={toolDims.w} min={0.5} max={300} step={0.5}
                    onChange={e => onToolDimsChange({ w: parseFloat(e.target.value) || 0.5, d: toolDims.d })}
                  />
                </div>
                <div>
                  <label className={styles.inpLabel}>Prof. (m)</label>
                  <input
                    type="number" value={toolDims.d} min={0.5} max={300} step={0.5}
                    onChange={e => onToolDimsChange({ w: toolDims.w, d: parseFloat(e.target.value) || 0.5 })}
                  />
                </div>
              </div>
            </div>
            <div className={styles.sep} />
          </>
        )}

        <div className={styles.stitle}>🏠 Casas</div>
        {houses.map(t => <ToolBtn key={t.id} {...t} />)}

        <div className={styles.sep} />
        <div className={styles.stitle}>🌿 Natureza</div>
        {nature.map(t => <ToolBtn key={t.id} {...t} />)}

        <div className={styles.sep} />
        <div className={styles.stitle}>🌍 Solos</div>
        {soils.map(t => <ToolBtn key={t.id} {...t} />)}

        <div className={styles.sep} />
        <div className={styles.stitle}>🏗️ Estruturas</div>
        {structs.map(t => <ToolBtn key={t.id} {...t} />)}

        <div className={styles.sep} />
        <button
          className={`${styles.btn} ${styles.red} ${currentTool === 'delete' ? styles.active : ''}`}
          onClick={() => cmd().setCurrentTool(currentTool === 'delete' ? null : 'delete')}
        >
          <span className={styles.ico}>🗑️</span>Remover elemento
        </button>
        <button className={styles.btn} onClick={() => cmd().clearElements()}>
          <span className={styles.ico}>🔄</span>Limpar elementos
        </button>

        <div className={styles.sep} />
        <div className={styles.stitle}>Câmera</div>
        <div className={styles.row2}>
          <button className={styles.btn} onClick={() => cmd().camV('top')}>
            <span className={styles.ico}>🗺️</span>Superior
          </button>
          <button className={styles.btn} onClick={() => cmd().camV('persp')}>
            <span className={styles.ico}>👁️</span>3D
          </button>
          <button className={styles.btn} onClick={() => cmd().camV('iso')}>
            <span className={styles.ico}>📐</span>Iso
          </button>
          <button className={styles.btn} onClick={() => cmd().rotLast(-45)}>
            <span className={styles.ico}>↺</span>-45°
          </button>
        </div>
      </>
    )
  }

  return (
    <div className={styles.sidebar}>

      {/* ── Project manager ─────────────────────────────────────────── */}
      <div className={styles.projArea}>
        <div className={styles.projNameRow}>
          <input
            className={styles.projNameInput}
            value={projName}
            onChange={e => setProjName(e.target.value)}
            placeholder="Nome do projeto"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button
            className={styles.projSaveBtn}
            onClick={handleSave}
            disabled={saving}
            title="Salvar projeto"
          >
            {saving ? '…' : '💾'}
          </button>
        </div>

        <div className={styles.projActions}>
          <button
            className={`${styles.projToggleBtn} ${showProjects ? styles.active : ''}`}
            onClick={() => setShowProjects(v => !v)}
          >
            📂 Meus projetos
            {savedList.length > 0 && <span className={styles.projCount}>{savedList.length}</span>}
          </button>
          <button className={styles.projNewBtn} onClick={handleNewProject} title="Novo projeto">
            ✦ Novo
          </button>
        </div>

        {showProjects && (
          <div className={styles.projList}>
            {savedList.length === 0 ? (
              <div className={styles.projEmpty}>Nenhum projeto salvo</div>
            ) : savedList.map(p => (
              <div
                key={p.id}
                className={`${styles.projItem} ${p.id === projId ? styles.active : ''}`}
                onClick={() => handleLoad(p.id, p.name)}
              >
                <div className={styles.projItemBody}>
                  <span className={styles.projItemName}>{p.name}</span>
                  <span className={styles.projItemMeta}>
                    {fmtDate(p.savedAt)} · {p.elementCount} obj
                  </span>
                </div>
                <button
                  className={styles.projDeleteBtn}
                  onClick={e => handleDelete(p.id, e)}
                  title="Deletar"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className={styles.tabs}>
        {(['terrain', 'zones', 'elements'] as ActiveTab[]).map((tab) => {
          const labels: Record<ActiveTab, string> = { terrain: '🗺️ Terreno', zones: '🎨 Zonas', elements: '🏠 Objetos' }
          return (
            <button
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.active : ''}`}
              onClick={() => onTabChange(tab)}
            >
              {labels[tab]}
            </button>
          )
        })}
      </div>

      <div className={`${styles.tabContent} ${activeTab === 'terrain' ? styles.active : ''}`}>
        {TerrainTab()}
      </div>
      <div className={`${styles.tabContent} ${activeTab === 'zones' ? styles.active : ''}`}>
        {ZonesTab()}
      </div>
      <div className={`${styles.tabContent} ${activeTab === 'elements' ? styles.active : ''}`}>
        {ElementsTab()}
      </div>

      <div className={styles.exportBar}>
        <button className={styles.btn} onClick={onExport}>
          <span className={styles.ico}>🖼️</span>Exportar / Compartilhar
        </button>
      </div>
    </div>
  )
})

export default Sidebar

// ── Terrain Stats panel ───────────────────────────────────────────────────

function TerrainStats({ stats }: { stats: TerrainStats | null }) {
  if (!stats) {
    return <div className={styles.info}>Sem terreno definido.</div>
  }
  return (
    <div className={styles.info}>
      <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: 4 }}>📐 Lados:</div>
      {stats.sides.map((s, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
          <span style={{ color: '#64748b' }}>Lado {i + 1}</span>
          <b style={{ color: '#ffd700' }}>{s.len.toFixed(1)} m</b>
        </div>
      ))}
      <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid #334155' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#64748b' }}>Pontos</span>
          <b style={{ color: '#38bdf8' }}>{stats.points}</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#64748b' }}>Área</span>
          <b style={{ color: '#38bdf8' }}>{stats.area.toFixed(0)} m²</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#64748b' }}>Perímetro</span>
          <b style={{ color: '#38bdf8' }}>{stats.perim.toFixed(1)} m</b>
        </div>
        {stats.closed && (
          <div style={{ color: '#00ff88', marginTop: 3, fontSize: 10 }}>✅ Terreno fechado</div>
        )}
      </div>
    </div>
  )
}
