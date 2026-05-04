'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import Sidebar from './Sidebar'
import ExportPanel from './ExportPanel'
import styles from './TerrainApp.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

export type ActiveTab = 'terrain' | 'zones' | 'elements'
export type ZoneType = 'mata' | 'limpo' | 'agua'

export interface TerrainStats {
  sides: { len: number }[]
  points: number
  area: number
  perim: number
  closed: boolean
}

export interface SelectedZoneInfo {
  type: ZoneType
  width: number
  depth: number
  area: number
}

export interface SelectedElementInfo {
  idx: number
  type: string
  label: string
  ryDeg: number
  sx: number
  sz: number
}

export interface SceneCommands {
  setupRect: (w: number, d: number) => void
  closeTerrain: () => void
  undoPoint: () => void
  resetTerrain: () => void
  deleteSelectedZone: () => void
  clearZones: () => void
  clearElements: () => void
  rotLast: (deg: number) => void
  camV: (v: 'top' | 'persp' | 'iso') => void
  setZoneTool: (type: ZoneType | null) => void
  setCurrentTool: (tool: string | null) => void
  cleanupForTabSwitch: () => void
  getSceneData: () => ProjectSceneData
  restoreSceneData: (data: ProjectSceneData) => void
  updateSelectedElement: (ryDeg: number, sx: number, sz: number) => void
  deleteSelectedElement: () => void
  getCanvasDataURL: (fmt?: 'png' | 'jpeg') => string
}

// ── Types: project data ───────────────────────────────────────────────────────

export interface ProjectSceneData {
  v: number
  terrain: { pts: Array<{ x: number; z: number }>; closed: boolean }
  zones: Array<{ type: ZoneType; x1: number; z1: number; x2: number; z2: number }>
  elements: Array<{ type: string; x: number; z: number; y?: number; ry: number; sx?: number; sz?: number }>
}

export interface ProjMeta {
  id: string
  name: string
  savedAt: number
  elementCount: number
}

interface ProjRecord extends ProjectSceneData {
  id: string
  name: string
  savedAt: number
}

// ── IndexedDB multi-project helpers ───────────────────────────────────────────

const IDB_NAME = 'planta-system'
const IDB_PROJECTS = 'projects'

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 2)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(IDB_PROJECTS))
        r.result.createObjectStore(IDB_PROJECTS, { keyPath: 'id' })
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function idbSaveProject(id: string, name: string, data: ProjectSceneData): Promise<void> {
  const db = await idbOpen()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_PROJECTS, 'readwrite')
    tx.objectStore(IDB_PROJECTS).put({ ...data, id, name, savedAt: Date.now() })
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

export async function idbListProjects(): Promise<ProjMeta[]> {
  const db = await idbOpen()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_PROJECTS, 'readonly')
    const req = tx.objectStore(IDB_PROJECTS).getAll()
    req.onsuccess = () => res(
      (req.result as ProjRecord[])
        .map(r => ({ id: r.id, name: r.name, savedAt: r.savedAt, elementCount: r.elements?.length ?? 0 }))
        .sort((a, b) => b.savedAt - a.savedAt)
    )
    req.onerror = () => rej(req.error)
  })
}

export async function idbLoadProject(id: string): Promise<ProjRecord | undefined> {
  const db = await idbOpen()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_PROJECTS, 'readonly')
    const req = tx.objectStore(IDB_PROJECTS).get(id)
    req.onsuccess = () => res(req.result as ProjRecord | undefined)
    req.onerror = () => rej(req.error)
  })
}

export async function idbDeleteProject(id: string): Promise<void> {
  const db = await idbOpen()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_PROJECTS, 'readwrite')
    tx.objectStore(IDB_PROJECTS).delete(id)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

// Module-level footprint table (w × d in metres, at scale 1)
export const FOOTPRINTS: Record<string, { w: number; d: number }> = {
  'house-alv':       { w: 12, d: 10 },
  'house-chale':     { w: 8,  d: 9  },
  'house-container': { w: 13, d: 5  },
  'house-trad':      { w: 11, d: 10 },
  tree:              { w: 4,  d: 4  },
  palm:              { w: 4,  d: 4  },
  orchard:           { w: 4,  d: 4  },
  garden:            { w: 5,  d: 4  },
  shed:              { w: 11, d: 8  },
  pool:              { w: 6,  d: 4  },
  fence:             { w: 4,  d: 1  },
  path:              { w: 2,  d: 6  },
  tank:              { w: 3,  d: 3  },
  rock:              { w: 2,  d: 2  },
  gravel:            { w: 3,  d: 3  },
  grass:             { w: 5,   d: 5   },
  'soil-red':        { w: 4,   d: 4   },
  'soil-dark':       { w: 4,   d: 4   },
  'soil-light':      { w: 4,   d: 4   },
  wall:              { w: 4,   d: 0.3 },
  pergola:           { w: 5,   d: 4   },
  greenhouse:        { w: 6,   d: 4   },
  well:              { w: 1.5, d: 1.5 },
  firepit:           { w: 2,   d: 2   },
  steps:             { w: 3,   d: 2   },
  parking:           { w: 5,   d: 2.5 },
  hedge:             { w: 4,   d: 1   },
  bamboo:            { w: 2,   d: 2   },
  cactus:            { w: 1,   d: 1   },
}

// Elements that sit flat on the ground and must visually overlay zone colours
const GROUND_COVER_TYPES = new Set([
  'grass', 'gravel', 'soil-red', 'soil-dark', 'soil-light',
  'path', 'parking', 'steps', 'garden',
])

// Apply renderOrder for placement stacking; for ground-cover disable depthTest so flat
// planes always draw on top of zone overlays without physically floating off the ground.
function applyLayering(obj: THREE.Object3D, idx: number, isGroundCover: boolean) {
  const order = idx + 10  // zones default to renderOrder 0
  obj.traverse(child => {
    child.renderOrder = order
    if (isGroundCover) {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach(m => { m.depthTest = false })
      }
    }
  })
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TerrainApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mlabelsRef = useRef<HTMLDivElement>(null)
  const commandsRef = useRef<SceneCommands | null>(null)

  const [activeTab, setActiveTab] = useState<ActiveTab>('terrain')
  const [navMode, setNavMode] = useState(true)
  const [terrainStats, setTerrainStats] = useState<TerrainStats | null>(null)
  const [topbarMsg, setTopbarMsg] = useState('Crie um retângulo base ou clique para adicionar pontos ao terreno')
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [posText, setPosText] = useState('—')
  const [zoneTool, setZoneTool] = useState<ZoneType | null>(null)
  const [selectedZone, setSelectedZone] = useState<SelectedZoneInfo | null>(null)
  const [currentTool, setCurrentTool] = useState<string | null>(null)
  const [toolDims, setToolDims] = useState<{ w: number; d: number } | null>(null)
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null)
  const [showExport, setShowExport] = useState(false)

  const activeTabRef = useRef(activeTab)
  const navModeRef = useRef(navMode)
  const toolDimsRef = useRef<{ w: number; d: number } | null>(null)

  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])
  useEffect(() => { navModeRef.current = navMode }, [navMode])

  const handleToolDimsChange = useCallback((dims: { w: number; d: number }) => {
    const clamped = { w: Math.max(0.5, dims.w), d: Math.max(0.5, dims.d) }
    setToolDims(clamped)
    toolDimsRef.current = clamped
  }, [])

  const handleNavToggle = useCallback(() => {
    setNavMode(prev => {
      const next = !prev
      navModeRef.current = next
      return next
    })
  }, [])

  const handleTabChange = useCallback((tab: ActiveTab) => {
    commandsRef.current?.cleanupForTabSwitch()
    setActiveTab(tab)
    const msgs: Record<ActiveTab, string> = {
      terrain: 'Crie um retângulo base ou clique para adicionar pontos. Arraste um ponto para mover.',
      zones: 'Selecione um tipo, arraste para criar zona. Clique na zona para editar cantos.',
      elements: 'Selecione um objeto e clique no terreno para posicionar. Sem ferramenta: arraste para mover.',
    }
    setTopbarMsg(msgs[tab])
  }, [])

  // ── Three.js Scene ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const mlabels = mlabelsRef.current!

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x87ceeb)
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.007)

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800)

    function resize() {
      const w = wrap.clientWidth, h = wrap.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    scene.add(new THREE.AmbientLight(0xffffff, 0.65))
    const sun = new THREE.DirectionalLight(0xffd580, 1.3)
    sun.position.set(25, 55, 20)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera as THREE.OrthographicCamera
    sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 1; sc.far = 300
    scene.add(sun)

    const baseGnd = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800),
      new THREE.MeshLambertMaterial({ color: 0x2a3a1a })
    )
    baseGnd.rotation.x = -Math.PI / 2; baseGnd.position.y = -0.02; baseGnd.receiveShadow = true
    scene.add(baseGnd)

    const gridH = new THREE.GridHelper(400, 400, 0x000000, 0x000000)
    gridH.position.y = 0.01
    const gridMat = gridH.material as THREE.LineBasicMaterial
    gridMat.opacity = 0.07; gridMat.transparent = true
    scene.add(gridH)

    // CAMERA ORBIT
    const sph = { th: 0.55, ph: 1.05, r: 80 }
    const tSph = { th: 0.55, ph: 1.05, r: 80 }
    const tgt = new THREE.Vector3()
    const tgtTgt = new THREE.Vector3()
    const DAMP = 0.10

    function camUpdate() {
      camera.position.set(
        tgt.x + sph.r * Math.sin(sph.ph) * Math.sin(sph.th),
        tgt.y + sph.r * Math.cos(sph.ph),
        tgt.z + sph.r * Math.sin(sph.ph) * Math.cos(sph.th)
      )
      camera.lookAt(tgt)
    }
    camUpdate()

    // Re-pivot orbit to terrain centroid without moving the camera position
    function snapOrbitToTerrain() {
      const cx = TR.pts.length > 0 ? TR.pts.reduce((s, p) => s + p.x, 0) / TR.pts.length : 0
      const cz = TR.pts.length > 0 ? TR.pts.reduce((s, p) => s + p.z, 0) / TR.pts.length : 0
      // Current camera world position
      const camX = tgt.x + sph.r * Math.sin(sph.ph) * Math.sin(sph.th)
      const camY = tgt.y + sph.r * Math.cos(sph.ph)
      const camZ = tgt.z + sph.r * Math.sin(sph.ph) * Math.cos(sph.th)
      // Vector from new pivot to camera
      const vx = camX - cx, vy = camY, vz = camZ - cz
      const r  = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const ph = Math.acos(Math.min(1, Math.max(-1, vy / r)))
      const th = Math.atan2(vx, vz)
      tgt.set(cx, 0, cz); tgtTgt.set(cx, 0, cz)
      sph.r = r;  sph.th = th;  sph.ph = ph
      tSph.r = r; tSph.th = th; tSph.ph = ph
    }

    function camV(v: 'top' | 'persp' | 'iso') {
      tgt.set(0, 0, 0); tgtTgt.set(0, 0, 0)
      if (v === 'top')   { tSph.ph = 0.05; tSph.r = 90 }
      if (v === 'persp') { tSph.th = 0.55; tSph.ph = 1.05; tSph.r = 80 }
      if (v === 'iso')   { tSph.th = Math.PI / 4; tSph.ph = Math.PI / 4; tSph.r = 100 }
    }

    canvas.addEventListener('wheel', e => {
      tSph.r = Math.max(3, Math.min(200, tSph.r + e.deltaY * 0.07))
      e.preventDefault()
    }, { passive: false })
    canvas.addEventListener('contextmenu', e => e.preventDefault())

    // RAYCASTING
    const rc = new THREE.Raycaster()
    const gPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const mv = new THREE.Vector2()

    function getGroundPt(e: MouseEvent): THREE.Vector3 | null {
      const r = canvas.getBoundingClientRect()
      mv.x = ((e.clientX - r.left) / r.width) * 2 - 1
      mv.y = -((e.clientY - r.top) / r.height) * 2 + 1
      rc.setFromCamera(mv, camera)
      const pt = new THREE.Vector3()
      return rc.ray.intersectPlane(gPlane, pt) ? pt : null
    }

    function screenDist(wx: number, wy: number, wz: number, e: MouseEvent): number {
      const r = canvas.getBoundingClientRect()
      const v = new THREE.Vector3(wx, wy, wz).project(camera)
      if (v.z > 1) return Infinity
      const sx = (v.x + 1) / 2 * r.width
      const sy = (1 - (v.y + 1) / 2) * r.height
      return Math.hypot(sx - (e.clientX - r.left), sy - (e.clientY - r.top))
    }

    // TERRAIN
    interface TRPt { x: number; z: number }
    const TR = {
      pts: [] as TRPt[],
      closed: false,
      fillMesh: null as THREE.Mesh | null,
      edgeLines: [] as THREE.Line[],
      dotMeshes: [] as THREE.Mesh[],
      previewLine: null as THREE.Line | null,
      area: 0,
      perim: 0,
    }

    const snapT = (v: number) => Math.round(v * 2) / 2
    const edgeLen = (a: TRPt, b: TRPt) => Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2)

    function calcArea(pts: TRPt[]) {
      let a = 0
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length
        a += pts[i].x * pts[j].z - pts[j].x * pts[i].z
      }
      return Math.abs(a) / 2
    }
    function calcPerim(pts: TRPt[]) {
      let p = 0
      for (let i = 0; i < pts.length; i++) p += edgeLen(pts[i], pts[(i + 1) % pts.length])
      return p
    }

    function pointInTerrain(x: number, z: number): boolean {
      if (!TR.closed || TR.pts.length < 3) return true
      const pts = TR.pts
      let inside = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, zi = pts[i].z
        const xj = pts[j].x, zj = pts[j].z
        if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi))
          inside = !inside
      }
      return inside
    }

    function mkDot(x: number, z: number, col: number) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8),
        new THREE.MeshBasicMaterial({ color: col })
      )
      m.position.set(x, 0.35, z)
      return m
    }

    function pushTerrainStats() {
      const n = TR.pts.length
      if (!n) { setTerrainStats(null); return }
      const numE = TR.closed ? n : n - 1
      const sides: { len: number }[] = []
      for (let i = 0; i < numE; i++) sides.push({ len: edgeLen(TR.pts[i], TR.pts[(i + 1) % n]) })
      setTerrainStats({
        sides,
        points: n,
        area: TR.closed ? TR.area : calcArea(TR.pts),
        perim: TR.closed ? TR.perim : calcPerim(TR.pts),
        closed: TR.closed,
      })
    }

    function rebuildEdgeLines() {
      TR.edgeLines.forEach(l => scene.remove(l)); TR.edgeLines = []
      const n = TR.closed ? TR.pts.length : TR.pts.length - 1
      for (let i = 0; i < n; i++) {
        const a = TR.pts[i], b = TR.pts[(i + 1) % TR.pts.length]
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a.x, 0.18, a.z), new THREE.Vector3(b.x, 0.18, b.z),
        ])
        const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: TR.closed ? 0xff6600 : 0xffd700 }))
        scene.add(l); TR.edgeLines.push(l)
      }
    }

    function buildFillMesh() {
      if (TR.fillMesh) { scene.remove(TR.fillMesh); TR.fillMesh = null }
      if (TR.pts.length < 3) return
      const shape = new THREE.Shape()
      shape.moveTo(TR.pts[0].x, -TR.pts[0].z)
      for (let i = 1; i < TR.pts.length; i++) shape.lineTo(TR.pts[i].x, -TR.pts[i].z)
      shape.closePath()
      TR.fillMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshLambertMaterial({ color: 0x2a4a1a, side: THREE.DoubleSide })
      )
      TR.fillMesh.rotation.x = -Math.PI / 2; TR.fillMesh.position.y = 0.03
      TR.fillMesh.receiveShadow = true; TR.fillMesh.name = 'terrain'
      scene.add(TR.fillMesh)
    }

    function rebuildTRMeshes() {
      rebuildEdgeLines()
      if (TR.closed) buildFillMesh()
      TR.pts.forEach((p, i) => { if (TR.dotMeshes[i]) TR.dotMeshes[i].position.set(p.x, 0.35, p.z) })
      if (TR.previewLine) { scene.remove(TR.previewLine); TR.previewLine = null }
    }

    function addPoint(x: number, z: number) {
      if (TR.closed) return
      TR.pts.push({ x, z })
      const col = TR.pts.length === 1 ? 0x00ff88 : 0xffd700
      const d = mkDot(x, z, col); scene.add(d); TR.dotMeshes.push(d)
      rebuildTRMeshes(); pushTerrainStats()
    }

    function closeTerrain() {
      if (TR.pts.length < 3 || TR.closed) return
      TR.closed = true
      TR.area = calcArea(TR.pts); TR.perim = calcPerim(TR.pts)
      rebuildTRMeshes(); pushTerrainStats()
      showStatus(`Terreno fechado — ${TR.area.toFixed(0)} m²`)
    }

    function undoPoint() {
      if (!TR.pts.length || TR.closed) return
      TR.pts.pop()
      const d = TR.dotMeshes.pop(); if (d) scene.remove(d)
      rebuildTRMeshes(); pushTerrainStats()
    }

    function clearZonesInner() {
      zones.forEach(z => { if (z.mesh) scene.remove(z.mesh) }); zones.length = 0; selectZone(-1)
    }

    function clearElementsInner() {
      placed.forEach(o => scene.remove(o)); placed.length = 0
      lastPlaced = null; selectedPlacedIdx = -1; selElInd.visible = false; setSelectedElement(null)
    }

    function resetTerrain() {
      TR.pts = []; TR.closed = false
      TR.dotMeshes.forEach(d => scene.remove(d)); TR.dotMeshes = []
      TR.edgeLines.forEach(l => scene.remove(l)); TR.edgeLines = []
      if (TR.fillMesh) { scene.remove(TR.fillMesh); TR.fillMesh = null }
      if (TR.previewLine) { scene.remove(TR.previewLine); TR.previewLine = null }
      clearZonesInner(); clearElementsInner(); pushTerrainStats()
    }

    function setupRect(w: number, d: number) {
      resetTerrain()
      const hw = w / 2, hd = d / 2
      ;[[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].forEach(([x, z]) => addPoint(x, z))
      closeTerrain()
      tSph.r = Math.max(w, d) * 2.2; tgt.set(0, 0, 0); tgtTgt.set(0, 0, 0)
    }

    function updatePreviewLine(tx: number, tz: number) {
      if (TR.closed || !TR.pts.length) {
        if (TR.previewLine) { scene.remove(TR.previewLine); TR.previewLine = null }
        return
      }
      const last = TR.pts[TR.pts.length - 1]
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(last.x, 0.18, last.z), new THREE.Vector3(tx, 0.18, tz),
      ])
      if (TR.previewLine) scene.remove(TR.previewLine)
      TR.previewLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.4, transparent: true }))
      scene.add(TR.previewLine)
    }

    let hoverVtxIdx = -1
    function setHoverVtx(i: number) {
      if (i === hoverVtxIdx) return
      if (hoverVtxIdx !== -1 && TR.dotMeshes[hoverVtxIdx]) {
        ;(TR.dotMeshes[hoverVtxIdx].material as THREE.MeshBasicMaterial).color.setHex(hoverVtxIdx === 0 ? 0x00ff88 : 0xffd700)
        TR.dotMeshes[hoverVtxIdx].scale.setScalar(1)
      }
      hoverVtxIdx = i
      if (i !== -1 && TR.dotMeshes[i]) {
        ;(TR.dotMeshes[i].material as THREE.MeshBasicMaterial).color.setHex(0xff4444)
        TR.dotMeshes[i].scale.setScalar(1.6)
      }
    }

    function findNearestVertex(e: MouseEvent, threshold = 20): number {
      let best = -1, bestD = threshold
      TR.pts.forEach((p, i) => {
        const d = screenDist(p.x, 0.35, p.z, e)
        if (d < bestD) { bestD = d; best = i }
      })
      return best
    }

    // ZONES
    const ZONE_COL: Record<ZoneType, number> = { mata: 0x1a5a00, limpo: 0x4aaa1a, agua: 0x0099cc }
    const ZONE_NAME: Record<ZoneType, string> = { mata: 'Mata nativa', limpo: 'Área limpa', agua: 'Lago/Água' }

    interface Zone { type: ZoneType; x1: number; z1: number; x2: number; z2: number; mesh: THREE.Mesh | null }
    const zones: Zone[] = []
    let selZoneIdx = -1
    let currentZoneTool: ZoneType | null = null
    const zoneHandles: THREE.Mesh[] = []

    function zoneCorners(z: Zone) {
      return [{ x: z.x1, z: z.z1 }, { x: z.x2, z: z.z1 }, { x: z.x2, z: z.z2 }, { x: z.x1, z: z.z2 }]
    }

    function buildZoneMesh(zone: Zone) {
      if (zone.mesh) scene.remove(zone.mesh)
      const w = zone.x2 - zone.x1, d = zone.z2 - zone.z1
      const isWater = zone.type === 'agua'
      zone.mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshLambertMaterial({
          color: ZONE_COL[zone.type],
          transparent: true,
          opacity: isWater ? 0.88 : (zone === zones[selZoneIdx] ? 0.82 : 0.65),
          side: THREE.DoubleSide,
        })
      )
      zone.mesh.rotation.x = -Math.PI / 2
      // agua slightly higher so it's visible above terrain fill
      zone.mesh.position.set((zone.x1 + zone.x2) / 2, isWater ? 0.11 : 0.07, (zone.z1 + zone.z2) / 2)
      scene.add(zone.mesh)
    }

    function refreshHandles() {
      zoneHandles.forEach(h => scene.remove(h)); zoneHandles.length = 0
      if (selZoneIdx === -1 || !zones[selZoneIdx]) return
      zoneCorners(zones[selZoneIdx]).forEach(c => {
        const h = new THREE.Mesh(
          new THREE.SphereGeometry(0.4, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff8800 })
        )
        h.position.set(c.x, 0.38, c.z); scene.add(h); zoneHandles.push(h)
      })
    }

    function selectZone(idx: number) {
      if (selZoneIdx !== idx) {
        if (selZoneIdx !== -1 && zones[selZoneIdx]) buildZoneMesh(zones[selZoneIdx])
        selZoneIdx = idx
        if (idx !== -1) buildZoneMesh(zones[idx])
      }
      refreshHandles()
      if (idx === -1) { setSelectedZone(null); return }
      const z = zones[idx]
      const w = z.x2 - z.x1, d = z.z2 - z.z1
      setSelectedZone({ type: z.type, width: parseFloat(w.toFixed(1)), depth: parseFloat(d.toFixed(1)), area: parseFloat((w * d).toFixed(0)) })
    }

    function createZone(type: ZoneType, x1: number, z1: number, x2: number, z2: number) {
      const zone: Zone = {
        type, x1: Math.min(x1, x2), z1: Math.min(z1, z2),
        x2: Math.max(x1, x2), z2: Math.max(z1, z2), mesh: null,
      }
      buildZoneMesh(zone); zones.push(zone); selectZone(zones.length - 1)
      showStatus(`Zona "${ZONE_NAME[type]}" criada`)
    }

    function updateZoneCorner(zi: number, ci: number, nx: number, nz: number) {
      const z = zones[zi], SNAP = 0.5
      nx = Math.round(nx / SNAP) * SNAP; nz = Math.round(nz / SNAP) * SNAP
      if (ci === 0) { z.x1 = Math.min(nx, z.x2 - 0.5); z.z1 = Math.min(nz, z.z2 - 0.5) }
      if (ci === 1) { z.x2 = Math.max(nx, z.x1 + 0.5); z.z1 = Math.min(nz, z.z2 - 0.5) }
      if (ci === 2) { z.x2 = Math.max(nx, z.x1 + 0.5); z.z2 = Math.max(nz, z.z1 + 0.5) }
      if (ci === 3) { z.x1 = Math.min(nx, z.x2 - 0.5); z.z2 = Math.max(nz, z.z1 + 0.5) }
      buildZoneMesh(z); refreshHandles(); selectZone(zi)
    }

    function findNearestZoneHandle(e: MouseEvent, threshold = 22): number {
      if (selZoneIdx === -1) return -1
      let best = -1, bestD = threshold
      zoneCorners(zones[selZoneIdx]).forEach((c, i) => {
        const d = screenDist(c.x, 0.38, c.z, e)
        if (d < bestD) { bestD = d; best = i }
      })
      return best
    }

    function findZoneAt(x: number, z: number): number {
      for (let i = zones.length - 1; i >= 0; i--) {
        const zo = zones[i]
        if (x >= zo.x1 && x <= zo.x2 && z >= zo.z1 && z <= zo.z2) return i
      }
      return -1
    }

    function deleteSelectedZone() {
      if (selZoneIdx === -1) return
      if (zones[selZoneIdx].mesh) scene.remove(zones[selZoneIdx].mesh!)
      zones.splice(selZoneIdx, 1); selectZone(-1)
    }

    let zonePreviewMesh: THREE.Mesh | null = null
    function showZonePreview(x1: number, z1: number, x2: number, z2: number) {
      const w = Math.max(Math.abs(x2 - x1), 0.1), d = Math.max(Math.abs(z2 - z1), 0.1)
      if (!zonePreviewMesh) {
        zonePreviewMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(w, d),
          new THREE.MeshBasicMaterial({ color: ZONE_COL[currentZoneTool!], transparent: true, opacity: 0.45, side: THREE.DoubleSide })
        )
        zonePreviewMesh.rotation.x = -Math.PI / 2; zonePreviewMesh.position.y = 0.09
        scene.add(zonePreviewMesh)
      } else {
        zonePreviewMesh.geometry.dispose()
        zonePreviewMesh.geometry = new THREE.PlaneGeometry(w, d)
      }
      ;(zonePreviewMesh.material as THREE.MeshBasicMaterial).color.setHex(ZONE_COL[currentZoneTool!])
      zonePreviewMesh.position.set((x1 + x2) / 2, 0.09, (z1 + z2) / 2)
    }
    function hideZonePreview() {
      if (zonePreviewMesh) { scene.remove(zonePreviewMesh); zonePreviewMesh = null }
    }

    // ELEMENT CREATORS
    function B(w: number, h: number, d: number, col: number) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col }))
      m.castShadow = true; m.receiveShadow = true; return m
    }
    const FG = [0x1a5a00, 0x2d7a1a, 0x0d4a00, 0x3d8a2a, 0x145e05]

    function mkTree(x: number, z: number, h = 4, r = 1.2, tc = 0x4a3000, fc = 0x1a5c1a) {
      const g = new THREE.Group()
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.20, h * 0.38, 7), new THREE.MeshLambertMaterial({ color: tc }))
      trunk.position.y = h * 0.19; trunk.castShadow = true; g.add(trunk)
      const fol = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshLambertMaterial({ color: fc }))
      fol.position.y = h * 0.38 + r * 0.72; fol.castShadow = true; g.add(fol)
      g.position.set(x, 0, z); return g
    }

    type CreatorFn = (x: number, z: number) => THREE.Group
    const creators: Record<string, CreatorFn> = {
      'house-alv': (x, z) => {
        const g = new THREE.Group()
        const body = B(9, 3.2, 7, 0xddd0b8); body.position.y = 1.6; g.add(body)
        const wing = B(4, 2.6, 4.5, 0xccc0a8); wing.position.set(5, 1.3, -3.75); g.add(wing)
        const laje = B(9.8, 0.28, 7.8, 0xb0a090); laje.position.y = 3.34; g.add(laje)
        const lajeW = B(4.8, 0.28, 5, 0xa09080); lajeW.position.set(5, 2.74, -3.75); g.add(lajeW)
        const gd = B(2.8, 2.3, 0.12, 0x777777); gd.position.set(-2.2, 1.15, 3.56); g.add(gd)
        for (const [ox, oy, oz] of [[1.5, 2.1, 3.57], [3.8, 1.9, 3.57]] as [number, number, number][]) { const w = B(1.1, 0.9, 0.1, 0x87ceeb); w.position.set(ox, oy, oz); g.add(w) }
        for (const px of [-4.2, 4.2]) { const p = B(0.28, 3.2, 0.28, 0xccbbaa); p.position.set(px, 1.6, 3.2); g.add(p) }
        g.position.set(x, 0, z); g.userData = { type: 'house-alv', label: 'Casa Alvenaria' }; return g
      },
      'house-chale': (x, z) => {
        const g = new THREE.Group()
        const base = B(7, 2.8, 5.5, 0x9b7540); base.position.y = 1.4; g.add(base)
        const roof = new THREE.Mesh(new THREE.ConeGeometry(5.4, 5.8, 4), new THREE.MeshLambertMaterial({ color: 0x4a2c10 }))
        roof.rotation.y = Math.PI / 4; roof.position.y = 5.7; roof.castShadow = true; g.add(roof)
        const porch = B(7.4, 0.18, 2.2, 0x3a1e00); porch.position.set(0, 3.4, -3.5); g.add(porch)
        for (const px of [-3, 0, 3]) { const p = B(0.18, 1.1, 0.18, 0x6b4010); p.position.set(px, 0.55, -4.5); g.add(p) }
        const door = B(1, 2.2, 0.1, 0x5c3010); door.position.set(0, 1.1, 2.76); g.add(door)
        for (const ox of [-2.3, 2.3]) { const w = B(1, 0.9, 0.1, 0x87ceeb); w.position.set(ox, 1.8, 2.77); g.add(w) }
        g.position.set(x, 0, z); g.userData = { type: 'house-chale', label: 'Chalé' }; return g
      },
      'house-container': (x, z) => {
        const g = new THREE.Group()
        const c1 = B(12, 2.6, 2.4, 0x3a6a9a); c1.position.y = 1.3; g.add(c1)
        const c2 = B(12, 2.6, 2.4, 0x2a4a1a); c2.position.set(0, 5.2, 0); g.add(c2)
        const c3 = B(5, 2.6, 2.4, 0x8a3a2a); c3.position.set(-3.5, 1.3, -2.4); g.add(c3)
        const ribM = new THREE.MeshLambertMaterial({ color: 0x2a5a8a })
        for (let i = -5; i <= 5; i += 1.2) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.6, 2.41), ribM); r.position.set(i, 1.3, 0); g.add(r) }
        const deck = B(12.5, 0.14, 2.7, 0x5c3a00); deck.position.y = 0.07; g.add(deck)
        for (const [ox, side] of [[-3, 1], [3, 1], [0, -1]] as [number, number][]) { const w = B(2, 1.2, 0.1, 0x87ceeb); w.position.set(ox, 1.6, side * 1.21); g.add(w) }
        const door = B(0.9, 2.1, 0.1, 0x555555); door.position.set(5.1, 1.05, 1.21); g.add(door)
        g.position.set(x, 0, z); g.userData = { type: 'house-container', label: 'Casa Container' }; return g
      },
      'house-trad': (x, z) => {
        const g = new THREE.Group()
        const base = B(10, 3, 7, 0xfaf0e0); base.position.y = 1.5; g.add(base)
        const roof = new THREE.Mesh(new THREE.ConeGeometry(6.5, 2.4, 4), new THREE.MeshLambertMaterial({ color: 0xc04040 }))
        roof.rotation.y = Math.PI / 4; roof.position.y = 4.2; roof.castShadow = true; g.add(roof)
        const door = B(1.2, 2.3, 0.12, 0x6b3a1f); door.position.set(0, 1.15, 3.56); g.add(door)
        for (const ox of [-3.5, 3.5]) { const w = B(1.2, 1, 0.12, 0x87ceeb); w.position.set(ox, 2, 3.56); g.add(w) }
        const porch = B(10.5, 0.15, 2, 0xddd0c0); porch.position.set(0, 3.08, 4.5); g.add(porch)
        for (const px of [-4.5, -1.5, 1.5, 4.5]) { const c = B(0.2, 3, 0.2, 0xfaf0e0); c.position.set(px, 1.5, 4.5); g.add(c) }
        g.position.set(x, 0, z); g.userData = { type: 'house-trad', label: 'Casa Térrea' }; return g
      },
      tree: (x, z) => {
        const h = 4 + Math.random() * 2.5, r = 1 + Math.random() * 0.8
        const g = mkTree(0, 0, h, r, 0x5c3317, FG[Math.floor(Math.random() * FG.length)])
        g.position.set(x, 0, z); g.userData = { type: 'tree', label: 'Árvore' }; return g
      },
      palm: (x, z) => {
        const g = new THREE.Group()
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 7, 8), new THREE.MeshLambertMaterial({ color: 0x8b6914 }))
        trunk.position.y = 3.5; trunk.castShadow = true; g.add(trunk)
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const leaf = B(3.5, 0.06, 0.25, 0x2d8a2d); leaf.rotation.y = a; leaf.rotation.z = -Math.PI * 0.18; leaf.position.set(Math.cos(a) * 1.6, 7.2, Math.sin(a) * 1.6); g.add(leaf) }
        for (let i = 0; i < 5; i++) { const nut = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), new THREE.MeshLambertMaterial({ color: 0x7a5a10 })); nut.position.set(Math.cos(i * 1.26) * 0.4, 7, Math.sin(i * 1.26) * 0.4); g.add(nut) }
        g.position.set(x, 0, z); g.userData = { type: 'palm', label: 'Palmeira' }; return g
      },
      // single fruit tree (was 3×3 grid)
      orchard: (x, z) => {
        const g = new THREE.Group()
        const fc = [0xff3333, 0xffaa00, 0xff6600]
        g.add(mkTree(0, 0, 3.2, 1.1, 0x5c3317, 0x2e8b57))
        for (let f = 0; f < 9; f++) {
          const fr = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), new THREE.MeshLambertMaterial({ color: fc[f % 3] }))
          fr.position.set((Math.random() - 0.5) * 1.6, 2.2 + Math.random() * 0.7, (Math.random() - 0.5) * 1.6)
          g.add(fr)
        }
        g.position.set(x, 0, z); g.userData = { type: 'orchard', label: 'Frutífera' }; return g
      },
      garden: (x, z) => {
        const g = new THREE.Group()
        const patch = B(5, 0.14, 4, 0x7a5c14); patch.position.y = 0.07; g.add(patch)
        const cols = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xff6ee7]
        for (let i = 0; i < 14; i++) {
          const px = (Math.random() - 0.5) * 4.6, pz = (Math.random() - 0.5) * 3.6
          const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 4), new THREE.MeshLambertMaterial({ color: 0x2d8a2d })); st.position.set(px, 0.21, pz); g.add(st)
          const fl = new THREE.Mesh(new THREE.SphereGeometry(0.19, 6, 6), new THREE.MeshLambertMaterial({ color: cols[i % 5] })); fl.position.set(px, 0.48, pz); fl.castShadow = true; g.add(fl)
        }
        g.position.set(x, 0, z); g.userData = { type: 'garden', label: 'Jardim' }; return g
      },
      shed: (x, z) => {
        const g = new THREE.Group()
        const base = B(10, 4, 7, 0xb0b0b0); base.position.y = 2; g.add(base)
        const roof = B(10.8, 0.4, 7.8, 0x555555); roof.position.y = 4.2; g.add(roof)
        g.position.set(x, 0, z); g.userData = { type: 'shed', label: 'Galpão' }; return g
      },
      pool: (x, z) => {
        const g = new THREE.Group()
        const shell = B(6, 0.65, 4, 0xfafafa); shell.position.y = 0.33; g.add(shell)
        const water = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.6), new THREE.MeshLambertMaterial({ color: 0x0077b6, transparent: true, opacity: 0.88 }))
        water.rotation.x = -Math.PI / 2; water.position.y = 0.67; g.add(water)
        g.position.set(x, 0, z); g.userData = { type: 'pool', label: 'Piscina' }; return g
      },
      fence: (x, z) => {
        const g = new THREE.Group()
        const mat = new THREE.MeshLambertMaterial({ color: 0x9b7936 })
        for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), mat); p.position.set(-2 + i, 0.65, 0); p.castShadow = true; g.add(p) }
        for (const y of [0.42, 0.95]) { const r = new THREE.Mesh(new THREE.BoxGeometry(4, 0.09, 0.08), mat); r.position.y = y; g.add(r) }
        g.position.set(x, 0, z); g.userData = { type: 'fence', label: 'Cerca' }; return g
      },
      path: (x, z) => {
        const g = new THREE.Group()
        const road = B(2, 0.07, 6, 0x999999); road.position.y = 0.035; g.add(road)
        g.position.set(x, 0, z); g.userData = { type: 'path', label: 'Caminho' }; return g
      },
      tank: (x, z) => {
        const g = new THREE.Group()
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.5, 16), new THREE.MeshLambertMaterial({ color: 0x1a6ea8 }))
        cyl.position.y = 1.25; cyl.castShadow = true; g.add(cyl)
        g.position.set(x, 0, z); g.userData = { type: 'tank', label: "Caixa d'água" }; return g
      },
      // new: rocks
      rock: (x, z) => {
        const g = new THREE.Group()
        const cols = [0x888880, 0x9a9a90, 0x6e6e68]
        const count = 2 + Math.floor(Math.random() * 3)
        for (let i = 0; i < count; i++) {
          const s = 0.3 + Math.random() * 0.55
          const r = new THREE.Mesh(
            new THREE.IcosahedronGeometry(s, 0),
            new THREE.MeshLambertMaterial({ color: cols[i % 3] })
          )
          r.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
          r.scale.set(1, 0.65 + Math.random() * 0.35, 1)
          r.position.set((Math.random() - 0.5) * 1.2, s * 0.35, (Math.random() - 0.5) * 1.2)
          r.castShadow = true; g.add(r)
        }
        g.position.set(x, 0, z); g.userData = { type: 'rock', label: 'Pedra' }; return g
      },
      // new: gravel patch
      gravel: (x, z) => {
        const g = new THREE.Group()
        const base = new THREE.Mesh(
          new THREE.PlaneGeometry(3, 3),
          new THREE.MeshLambertMaterial({ color: 0xb0a898 })
        )
        base.rotation.x = -Math.PI / 2; base.position.y = 0.04; g.add(base)
        const cols = [0x9a9590, 0xb5afa8, 0x807870]
        for (let i = 0; i < 30; i++) {
          const pebble = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.08 + Math.random() * 0.1, 0),
            new THREE.MeshLambertMaterial({ color: cols[i % 3] })
          )
          pebble.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
          pebble.position.set((Math.random() - 0.5) * 2.6, 0.06, (Math.random() - 0.5) * 2.6)
          g.add(pebble)
        }
        g.position.set(x, 0, z); g.userData = { type: 'gravel', label: 'Cascalho' }; return g
      },
      // new: grass patch (dense)
      grass: (x, z) => {
        const g = new THREE.Group()
        const base = new THREE.Mesh(
          new THREE.PlaneGeometry(5, 5),
          new THREE.MeshLambertMaterial({ color: 0x3d7a12 })
        )
        base.rotation.x = -Math.PI / 2; base.position.y = 0.04; g.add(base)
        const cols = [0x336e0e, 0x4d8c18, 0x2a6008, 0x5a9a20, 0x3f7a14, 0x67a828]
        for (let i = 0; i < 160; i++) {
          const h = 0.15 + Math.random() * 0.42
          const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.055, h, 0.055),
            new THREE.MeshLambertMaterial({ color: cols[i % 6] })
          )
          blade.rotation.y = Math.random() * Math.PI
          blade.rotation.z = (Math.random() - 0.5) * 0.65
          blade.rotation.x = (Math.random() - 0.5) * 0.35
          blade.position.set((Math.random() - 0.5) * 4.7, h / 2, (Math.random() - 0.5) * 4.7)
          g.add(blade)
        }
        g.position.set(x, 0, z); g.userData = { type: 'grass', label: 'Grama' }; return g
      },
      'soil-red': (x, z) => {
        const g = new THREE.Group()
        const base = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshLambertMaterial({ color: 0x8B3A0F }))
        base.rotation.x = -Math.PI / 2; base.position.y = 0.04; g.add(base)
        for (let i = 0; i < 8; i++) {
          const clod = new THREE.Mesh(new THREE.SphereGeometry(0.12 + Math.random() * 0.12, 4, 3), new THREE.MeshLambertMaterial({ color: 0x7a3208 }))
          clod.scale.y = 0.4; clod.position.set((Math.random() - 0.5) * 3.5, 0.06, (Math.random() - 0.5) * 3.5); g.add(clod)
        }
        g.position.set(x, 0, z); g.userData = { type: 'soil-red', label: 'Terra Vermelha' }; return g
      },
      'soil-dark': (x, z) => {
        const g = new THREE.Group()
        const base = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshLambertMaterial({ color: 0x1a0e06 }))
        base.rotation.x = -Math.PI / 2; base.position.y = 0.04; g.add(base)
        for (let i = 0; i < 8; i++) {
          const clod = new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.1, 4, 3), new THREE.MeshLambertMaterial({ color: 0x2a1808 }))
          clod.scale.y = 0.4; clod.position.set((Math.random() - 0.5) * 3.5, 0.06, (Math.random() - 0.5) * 3.5); g.add(clod)
        }
        g.position.set(x, 0, z); g.userData = { type: 'soil-dark', label: 'Terra Escura' }; return g
      },
      'soil-light': (x, z) => {
        const g = new THREE.Group()
        const base = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshLambertMaterial({ color: 0xc4a272 }))
        base.rotation.x = -Math.PI / 2; base.position.y = 0.04; g.add(base)
        for (let i = 0; i < 8; i++) {
          const clod = new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.12, 4, 3), new THREE.MeshLambertMaterial({ color: 0xb8915e }))
          clod.scale.y = 0.4; clod.position.set((Math.random() - 0.5) * 3.5, 0.06, (Math.random() - 0.5) * 3.5); g.add(clod)
        }
        g.position.set(x, 0, z); g.userData = { type: 'soil-light', label: 'Terra Clara' }; return g
      },
      wall: (x, z) => {
        const g = new THREE.Group()
        const brickMat = new THREE.MeshLambertMaterial({ color: 0xb05a30 })
        const mortarMat = new THREE.MeshLambertMaterial({ color: 0xccbbaa })
        const body = new THREE.Mesh(new THREE.BoxGeometry(4, 1.8, 0.22), brickMat); body.position.y = 0.9; g.add(body)
        for (let row = 0; row < 4; row++) {
          for (let col = -1; col <= 1; col++) {
            const mortar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.82, 0.24), mortarMat)
            mortar.position.set(col * 1.1 + (row % 2 === 0 ? 0.55 : 0), 0.9, 0); g.add(mortar)
          }
          const hLine = new THREE.Mesh(new THREE.BoxGeometry(4.02, 0.06, 0.24), mortarMat)
          hLine.position.y = 0.45 * row + 0.22; g.add(hLine)
        }
        const cap = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.1, 0.32), mortarMat); cap.position.y = 1.85; g.add(cap)
        g.position.set(x, 0, z); g.userData = { type: 'wall', label: 'Muro' }; return g
      },
      pergola: (x, z) => {
        const g = new THREE.Group()
        const mat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C })
        for (const [px, pz] of [[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2]] as [number, number][]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 0.18), mat); post.position.set(px, 1.4, pz); post.castShadow = true; g.add(post)
        }
        for (const pz of [-2, 2]) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 0.16), mat); beam.position.set(0, 2.85, pz); g.add(beam)
        }
        for (let i = -2.2; i <= 2.2; i += 0.75) {
          const slat = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 4.2), mat); slat.position.set(i, 3.0, 0); g.add(slat)
        }
        g.position.set(x, 0, z); g.userData = { type: 'pergola', label: 'Pérgola' }; return g
      },
      greenhouse: (x, z) => {
        const g = new THREE.Group()
        const frame = new THREE.MeshLambertMaterial({ color: 0x888888 })
        const glass = new THREE.MeshLambertMaterial({ color: 0x87ceeb, transparent: true, opacity: 0.38, side: THREE.DoubleSide })
        const base = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 4), frame); base.position.y = 0.06; g.add(base)
        const wallF = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 0.05), glass); wallF.position.set(0, 1, 2); g.add(wallF)
        const wallB = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 0.05), glass); wallB.position.set(0, 1, -2); g.add(wallB)
        const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2, 4), glass); wallL.position.set(-3, 1, 0); g.add(wallL)
        const wallR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2, 4), glass); wallR.position.set(3, 1, 0); g.add(wallR)
        for (const [ox, rz] of [[-1.1, Math.PI / 5.5], [1.1, -Math.PI / 5.5]] as [number, number][]) {
          const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 2.3), glass)
          roofPanel.rotation.z = rz; roofPanel.position.set(ox, 2.4, 0); g.add(roofPanel)
        }
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.1, 0.1), frame); ridge.position.y = 3.1; g.add(ridge)
        g.position.set(x, 0, z); g.userData = { type: 'greenhouse', label: 'Estufa' }; return g
      },
      well: (x, z) => {
        const g = new THREE.Group()
        const stone = new THREE.MeshLambertMaterial({ color: 0x888070 })
        const wood = new THREE.MeshLambertMaterial({ color: 0x6b4010 })
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.9, 12), stone); cyl.position.y = 0.45; g.add(cyl)
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 12), stone); cap.position.y = 0.96; g.add(cap)
        for (const px of [-0.5, 0.5]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), wood); post.position.set(px, 1.55, 0); g.add(post) }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.1), wood); beam.position.y = 2.1; g.add(beam)
        const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x5c3010 })); bucket.position.set(0, 1.4, 0); g.add(bucket)
        g.position.set(x, 0, z); g.userData = { type: 'well', label: 'Poço' }; return g
      },
      firepit: (x, z) => {
        const g = new THREE.Group()
        const brick = new THREE.MeshLambertMaterial({ color: 0xa04020 })
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.2), brick); body.position.y = 0.5; g.add(body)
        const grate = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 0.9), new THREE.MeshLambertMaterial({ color: 0x444444 })); grate.position.y = 0.82; g.add(grate)
        const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.5, 0.38), brick); chimney.position.set(0.72, 1.75, 0); g.add(chimney)
        const fire = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff6600 })); fire.scale.y = 0.55; fire.position.set(-0.25, 1.02, 0); g.add(fire)
        const ember = new THREE.Mesh(new THREE.SphereGeometry(0.18, 5, 3), new THREE.MeshBasicMaterial({ color: 0xffcc00 })); ember.scale.y = 0.5; ember.position.set(-0.25, 0.95, 0); g.add(ember)
        g.position.set(x, 0, z); g.userData = { type: 'firepit', label: 'Churrasqueira' }; return g
      },
      steps: (x, z) => {
        const g = new THREE.Group()
        const mat = new THREE.MeshLambertMaterial({ color: 0xccbbaa })
        for (let i = 0; i < 3; i++) {
          const step = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 0.65), mat)
          step.position.set(0, 0.1 + i * 0.2, 0.65 - i * 0.65); g.add(step)
        }
        g.position.set(x, 0, z); g.userData = { type: 'steps', label: 'Escada' }; return g
      },
      parking: (x, z) => {
        const g = new THREE.Group()
        const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshLambertMaterial({ color: 0x333333 }))
        asphalt.rotation.x = -Math.PI / 2; asphalt.position.y = 0.04; g.add(asphalt)
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
        for (const ox of [-2.3, 2.3]) {
          const line = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 2.3), lineMat)
          line.rotation.x = -Math.PI / 2; line.position.set(ox, 0.05, 0); g.add(line)
        }
        for (const oz of [-1.2, 1.2]) {
          const line = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 0.07), lineMat)
          line.rotation.x = -Math.PI / 2; line.position.set(0, 0.05, oz); g.add(line)
        }
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), new THREE.MeshBasicMaterial({ color: 0x3b82f6 }))
        p.rotation.x = -Math.PI / 2; p.position.set(0, 0.05, 0); g.add(p)
        g.position.set(x, 0, z); g.userData = { type: 'parking', label: 'Vaga' }; return g
      },
      hedge: (x, z) => {
        const g = new THREE.Group()
        for (let i = 0; i < 4; i++) {
          const col = i % 2 === 0 ? 0x2d7a1a : 0x1f6010
          const bush = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 5), new THREE.MeshLambertMaterial({ color: col }))
          bush.scale.y = 0.85; bush.position.set(-1.5 + i, 0.47, 0); bush.castShadow = true; g.add(bush)
        }
        g.position.set(x, 0, z); g.userData = { type: 'hedge', label: 'Sebe' }; return g
      },
      bamboo: (x, z) => {
        const g = new THREE.Group()
        const cols = [0x5a8a10, 0x4a7a08, 0x6a9a18]
        for (let i = 0; i < 7; i++) {
          const px = (Math.random() - 0.5) * 1.6, pz = (Math.random() - 0.5) * 1.6
          const h = 3 + Math.random() * 2.2
          const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, h, 6), new THREE.MeshLambertMaterial({ color: cols[i % 3] }))
          cane.position.set(px, h / 2, pz); cane.castShadow = true; g.add(cane)
          for (let j = 1; j < Math.floor(h * 0.9); j++) {
            const node = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 6), new THREE.MeshLambertMaterial({ color: 0x3a6a00 }))
            node.position.set(px, j * 0.85, pz); g.add(node)
          }
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.4, 5, 4), new THREE.MeshLambertMaterial({ color: 0x3a7a10 }))
          leaf.scale.set(1.3, 0.55, 1.3); leaf.position.set(px, h - 0.15, pz); g.add(leaf)
        }
        g.position.set(x, 0, z); g.userData = { type: 'bamboo', label: 'Bambu' }; return g
      },
      cactus: (x, z) => {
        const g = new THREE.Group()
        const mat = new THREE.MeshLambertMaterial({ color: 0x3a7a20 })
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.8, 8), mat); trunk.position.y = 0.9; trunk.castShadow = true; g.add(trunk)
        for (const [side, h] of [[-1, 0.8], [1, 1.2]] as [number, number][]) {
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.85, 6), mat)
          arm.rotation.z = side * Math.PI / 2.2; arm.position.set(side * 0.38, h, 0); g.add(arm)
          const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 6), mat)
          tip.position.set(side * 0.82, h + 0.22, 0); g.add(tip)
        }
        const flower = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 4), new THREE.MeshLambertMaterial({ color: 0xff4488 }))
        flower.position.y = 1.92; g.add(flower)
        g.position.set(x, 0, z); g.userData = { type: 'cactus', label: 'Cacto' }; return g
      },
    }

    // ELEMENT TOOL
    let currentElementTool: string | null = null
    const placed: THREE.Group[] = []
    let lastPlaced: THREE.Group | null = null
    let selectedPlacedIdx = -1

    // selection ring for placed elements
    const selElInd = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.1, 24),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
    )
    selElInd.rotation.x = -Math.PI / 2; selElInd.position.y = 0.14; selElInd.visible = false
    scene.add(selElInd)

    // Footprint preview (placement bounding-box)
    let fpFill: THREE.Mesh | null = null
    let fpEdge: THREE.LineLoop | null = null
    let fpLastTool = ''
    let fpLastW = 0, fpLastD = 0
    let fpHoverPos: { x: number; z: number } | null = null

    function updateFootprint(x: number, z: number, tool: string) {
      const fp = FOOTPRINTS[tool]
      if (!fp) { hideFootprint(); return }
      // Use custom dims if set, otherwise fall back to FOOTPRINTS default
      const dims = toolDimsRef.current ?? fp
      const w = Math.max(0.5, dims.w)
      const d = Math.max(0.5, dims.d)
      const inside = pointInTerrain(x, z)
      const fillCol = inside ? 0x00ff88 : 0xff4444

      // Rebuild geometry when tool or dims change
      if (tool !== fpLastTool || w !== fpLastW || d !== fpLastD) {
        if (fpFill) { fpFill.geometry.dispose(); scene.remove(fpFill); fpFill = null }
        if (fpEdge) { fpEdge.geometry.dispose(); scene.remove(fpEdge); fpEdge = null }

        fpFill = new THREE.Mesh(
          new THREE.PlaneGeometry(w, d),
          new THREE.MeshBasicMaterial({ color: fillCol, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
        )
        fpFill.rotation.x = -Math.PI / 2; fpFill.position.y = 0.16
        fpFill.renderOrder = 9999
        scene.add(fpFill)

        fpEdge = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-w / 2, 0, -d / 2),
            new THREE.Vector3( w / 2, 0, -d / 2),
            new THREE.Vector3( w / 2, 0,  d / 2),
            new THREE.Vector3(-w / 2, 0,  d / 2),
          ]),
          new THREE.LineBasicMaterial({ color: fillCol, depthTest: false })
        )
        fpEdge.position.y = 0.18; fpEdge.renderOrder = 9999; scene.add(fpEdge)
        fpLastTool = tool; fpLastW = w; fpLastD = d
      }

      fpFill!.position.set(x, 0.16, z)
      fpEdge!.position.set(x, 0.18, z)
      ;(fpFill!.material as THREE.MeshBasicMaterial).color.setHex(fillCol)
      ;(fpEdge!.material as THREE.LineBasicMaterial).color.setHex(fillCol)
      fpFill!.visible = true; fpEdge!.visible = true
      fpHoverPos = { x, z }
    }

    function hideFootprint() {
      if (fpFill) fpFill.visible = false
      if (fpEdge) fpEdge.visible = false
      fpHoverPos = null
    }

    const hoverInd = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 14),
      new THREE.MeshBasicMaterial({ color: 0x00eeff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
    )
    hoverInd.rotation.x = -Math.PI / 2; hoverInd.position.y = 0.12
    hoverInd.renderOrder = 9998; hoverInd.visible = false
    scene.add(hoverInd)

    function rotLast(deg: number) {
      const target = selectedPlacedIdx !== -1 ? placed[selectedPlacedIdx] : lastPlaced
      if (target) target.rotation.y += deg * Math.PI / 180
    }

    // find placed element at current mouse position (uses current mv)
    function findPlacedAt(): number {
      rc.setFromCamera(mv, camera)
      const meshes: THREE.Mesh[] = []
      placed.forEach(o => o.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh) }))
      const hits = rc.intersectObjects(meshes)
      if (!hits.length) return -1
      let obj: THREE.Object3D = hits[0].object
      while (obj.parent && obj.parent !== scene) obj = obj.parent
      return placed.indexOf(obj as THREE.Group)
    }

    // STATUS
    let statusTimeout: ReturnType<typeof setTimeout> | null = null
    function showStatus(msg: string) {
      setStatusMsg(msg)
      if (statusTimeout) clearTimeout(statusTimeout)
      statusTimeout = setTimeout(() => setStatusMsg(null), 2500)
    }

    // EDIT STATE MACHINE
    const ES = { mode: 'idle', vtxIdx: -1, zoneIdx: -1, cornerIdx: -1, startX: 0, startZ: 0, elDragStartX: 0, elDragStartZ: 0 }
    let orbiting = false, orbitLx = 0, orbitLy = 0
    let leftDown = false, leftMovedDist = 0, leftLx = 0, leftLy = 0
    let idleDragDist = 0  // accumulated drag while no edit-interaction is active

    function handleLeftDown(e: MouseEvent) {
      const pt = getGroundPt(e); if (!pt) return
      leftLx = e.clientX; leftLy = e.clientY; leftMovedDist = 0

      if (activeTabRef.current === 'terrain') {
        const vi = findNearestVertex(e)
        if (vi !== -1) { ES.mode = 'drag-vertex'; ES.vtxIdx = vi; return }
      }
      if (activeTabRef.current === 'zones') {
        const ci = findNearestZoneHandle(e)
        if (ci !== -1) { ES.mode = 'drag-zone-corner'; ES.zoneIdx = selZoneIdx; ES.cornerIdx = ci; return }
        const zi = findZoneAt(pt.x, pt.z)
        if (zi !== -1) { selectZone(zi); ES.mode = 'idle'; return }
        if (currentZoneTool && TR.closed) {
          ES.mode = 'draw-zone'; ES.startX = pt.x; ES.startZ = pt.z
          showZonePreview(pt.x, pt.z, pt.x, pt.z); return
        }
      }
      // element drag/select: when no tool or using delete, try to grab an existing element
      if (activeTabRef.current === 'elements' && (!currentElementTool || currentElementTool === 'delete')) {
        const ei = findPlacedAt()
        if (ei !== -1 && currentElementTool !== 'delete') {
          selectedPlacedIdx = ei
          lastPlaced = placed[ei]
          selElInd.position.set(placed[ei].position.x, 0.14, placed[ei].position.z)
          selElInd.visible = true
          setSelectedElement({ idx: ei, type: placed[ei].userData.type as string, label: placed[ei].userData.label as string, ryDeg: Math.round(placed[ei].rotation.y * 180 / Math.PI), sx: parseFloat(placed[ei].scale.x.toFixed(2)), sz: parseFloat(placed[ei].scale.z.toFixed(2)) })
          ES.mode = 'drag-element'
          ES.elDragStartX = pt.x - placed[ei].position.x
          ES.elDragStartZ = pt.z - placed[ei].position.z
          return
        }
      }
    }

    function handleLeftMove(e: MouseEvent) {
      const pt = getGroundPt(e); if (!pt) return
      const dx = e.clientX - leftLx, dy = e.clientY - leftLy
      leftMovedDist += Math.abs(dx) + Math.abs(dy)
      if (ES.mode === 'drag-vertex') {
        TR.pts[ES.vtxIdx] = { x: snapT(pt.x), z: snapT(pt.z) }
        rebuildTRMeshes()
        if (TR.closed) { TR.area = calcArea(TR.pts); TR.perim = calcPerim(TR.pts) }
        pushTerrainStats()
      } else if (ES.mode === 'draw-zone') {
        showZonePreview(ES.startX, ES.startZ, pt.x, pt.z)
      } else if (ES.mode === 'drag-zone-corner') {
        updateZoneCorner(ES.zoneIdx, ES.cornerIdx, pt.x, pt.z)
      } else if (ES.mode === 'drag-element') {
        if (selectedPlacedIdx !== -1 && placed[selectedPlacedIdx]) {
          const nx = pt.x - ES.elDragStartX
          const nz = pt.z - ES.elDragStartZ
          placed[selectedPlacedIdx].position.x = nx
          placed[selectedPlacedIdx].position.z = nz
          selElInd.position.set(nx, 0.14, nz)
        }
      }
      leftLx = e.clientX; leftLy = e.clientY
    }

    function handleLeftUp(e: MouseEvent) {
      const movedALot = leftMovedDist > 5

      if (ES.mode === 'draw-zone') {
        hideZonePreview()
        const pt = getGroundPt(e)
        if (pt && currentZoneTool) {
          if (Math.abs(pt.x - ES.startX) > 0.5 && Math.abs(pt.z - ES.startZ) > 0.5)
            createZone(currentZoneTool, ES.startX, ES.startZ, pt.x, pt.z)
        }
        ES.mode = 'idle'; return
      }
      if (ES.mode === 'drag-vertex') { ES.mode = 'idle'; return }
      if (ES.mode === 'drag-zone-corner') { ES.mode = 'idle'; return }
      if (ES.mode === 'drag-element') {
        // snap to 0.5m grid on release
        if (selectedPlacedIdx !== -1 && placed[selectedPlacedIdx]) {
          const p = placed[selectedPlacedIdx]
          p.position.x = Math.round(p.position.x * 2) / 2
          p.position.z = Math.round(p.position.z * 2) / 2
          selElInd.position.set(p.position.x, 0.14, p.position.z)
        }
        ES.mode = 'idle'; return
      }

      if (!movedALot) {
        const pt = getGroundPt(e); if (!pt) return
        const sx = Math.round(pt.x * 2) / 2
        const sz = Math.round(pt.z * 2) / 2

        if (activeTabRef.current === 'terrain' && !TR.closed) {
          if (TR.pts.length >= 3 && edgeLen({ x: pt.x, z: pt.z }, TR.pts[0]) < 2) { closeTerrain(); return }
          addPoint(snapT(pt.x), snapT(pt.z))
        }

        if (activeTabRef.current === 'elements' && currentElementTool) {
          if (currentElementTool === 'delete') {
            rc.setFromCamera(mv, camera)
            const meshes: THREE.Mesh[] = []
            placed.forEach(o => o.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh) }))
            const hits = rc.intersectObjects(meshes)
            if (hits.length) {
              let obj: THREE.Object3D = hits[0].object
              while (obj.parent && obj.parent !== scene) obj = obj.parent
              const i = placed.indexOf(obj as THREE.Group)
              if (i !== -1) {
                scene.remove(obj); placed.splice(i, 1)
                if (lastPlaced === obj) lastPlaced = null
                if (selectedPlacedIdx === i) { selectedPlacedIdx = -1; selElInd.visible = false; setSelectedElement(null) }
                else if (selectedPlacedIdx > i) selectedPlacedIdx--
              }
            }
            return
          }
          if (creators[currentElementTool]) {
            if (!pointInTerrain(sx, sz)) { showStatus('Fora do terreno — clique dentro da área'); return }
            const obj = creators[currentElementTool](sx, sz)
            const fp = FOOTPRINTS[currentElementTool]
            const dims = toolDimsRef.current
            if (fp && dims) obj.scale.set(dims.w / fp.w, 1, dims.d / fp.d)
            applyLayering(obj, placed.length, GROUND_COVER_TYPES.has(currentElementTool))
            scene.add(obj); placed.push(obj); lastPlaced = obj
            selectedPlacedIdx = placed.length - 1
            selElInd.position.set(sx, 0.14, sz); selElInd.visible = true
            setSelectedElement({ idx: placed.length - 1, type: obj.userData.type as string, label: obj.userData.label as string, ryDeg: 0, sx: parseFloat(obj.scale.x.toFixed(2)), sz: parseFloat(obj.scale.z.toFixed(2)) })
            showStatus(`${obj.userData.label} adicionado`)
          }
        } else if (activeTabRef.current === 'elements' && !currentElementTool) {
          // click on empty space with no tool = deselect
          const ei = findPlacedAt()
          if (ei === -1) { selectedPlacedIdx = -1; selElInd.visible = false; setSelectedElement(null) }
          else {
            selectedPlacedIdx = ei; lastPlaced = placed[ei]
            selElInd.position.set(placed[ei].position.x, 0.14, placed[ei].position.z)
            selElInd.visible = true
            setSelectedElement({ idx: ei, type: placed[ei].userData.type as string, label: placed[ei].userData.label as string, ryDeg: Math.round(placed[ei].rotation.y * 180 / Math.PI), sx: parseFloat(placed[ei].scale.x.toFixed(2)), sz: parseFloat(placed[ei].scale.z.toFixed(2)) })
          }
        }
      }
      ES.mode = 'idle'
    }

    // MOUSE EVENT HANDLERS
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2 || (e.button === 0 && navModeRef.current)) {
        snapOrbitToTerrain()
        orbiting = true; orbitLx = e.clientX; orbitLy = e.clientY
        canvas.style.cursor = 'grabbing'; e.preventDefault(); return
      }
      if (e.button === 0 && !navModeRef.current) { leftDown = true; idleDragDist = 0; handleLeftDown(e) }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (orbiting) {
        const dx = e.clientX - orbitLx, dy = e.clientY - orbitLy
        tSph.th -= dx * 0.006
        tSph.ph = Math.max(0.05, Math.min(Math.PI / 2 - 0.01, tSph.ph + dy * 0.006))
        orbitLx = e.clientX; orbitLy = e.clientY; return
      }
      if (leftDown && ES.mode !== 'idle') { handleLeftMove(e); return }

      // idle left-drag (no edit target) → convert to orbit after a small threshold
      if (leftDown && ES.mode === 'idle') {
        hoverInd.visible = false; hideFootprint()  // hide preview as soon as button is held
        idleDragDist += Math.abs(e.clientX - leftLx) + Math.abs(e.clientY - leftLy)
        leftLx = e.clientX; leftLy = e.clientY
        if (idleDragDist > 5) {
          snapOrbitToTerrain()
          orbiting = true; leftDown = false
          orbitLx = e.clientX; orbitLy = e.clientY
          hoverInd.visible = false; hideFootprint()
          canvas.style.cursor = 'grabbing'
        }
        return
      }

      // ignore hover/preview logic when mouse is outside the canvas bounds
      const cr = canvas.getBoundingClientRect()
      if (e.clientX < cr.left || e.clientX > cr.right || e.clientY < cr.top || e.clientY > cr.bottom) {
        hoverInd.visible = false
        hideFootprint()
        return
      }

      const pt = getGroundPt(e)
      if (pt) setPosText(`X:${snapT(pt.x)}m  Z:${snapT(pt.z)}m`)

      if (navModeRef.current) { canvas.style.cursor = 'grab'; hoverInd.visible = false; return }

      if (activeTabRef.current === 'terrain') {
        const vi = findNearestVertex(e)
        setHoverVtx(vi)
        canvas.style.cursor = vi !== -1 ? 'move' : 'crosshair'
        if (pt) updatePreviewLine(pt.x, pt.z)
        hoverInd.visible = false
      } else if (activeTabRef.current === 'zones') {
        const ci = findNearestZoneHandle(e)
        canvas.style.cursor = ci !== -1 ? 'move' : 'crosshair'
        hoverInd.visible = false
      } else if (activeTabRef.current === 'elements') {
        if (currentElementTool && currentElementTool !== 'delete') {
          canvas.style.cursor = 'crosshair'
          if (pt) {
            const sx = Math.round(pt.x * 2) / 2
            const sz = Math.round(pt.z * 2) / 2
            hoverInd.visible = true
            hoverInd.position.set(sx, 0.12, sz)
            updateFootprint(sx, sz, currentElementTool)
          }
        } else {
          hoverInd.visible = false
          hideFootprint()
          canvas.style.cursor = 'default'
        }
      } else {
        hoverInd.visible = false; canvas.style.cursor = 'default'
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2 || (e.button === 0 && navModeRef.current)) {
        orbiting = false; canvas.style.cursor = navModeRef.current ? 'grab' : 'default'; return
      }
      if (e.button === 0 && !navModeRef.current) {
        if (orbiting) { orbiting = false; canvas.style.cursor = 'default'; return }
        const wasDown = leftDown; leftDown = false; idleDragDist = 0
        if (wasDown) handleLeftUp(e)  // only act if click started on the canvas
      }
    }

    const onDblClick = () => {
      if (activeTabRef.current === 'terrain' && TR.pts.length >= 3 && !TR.closed) closeTerrain()
    }

    const onMouseLeave = () => {
      hoverInd.visible = false; setHoverVtx(-1)
      if (TR.previewLine) { scene.remove(TR.previewLine); TR.previewLine = null }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectZone(-1); hideZonePreview(); ES.mode = 'idle'
        currentElementTool = null; setCurrentTool(null); hoverInd.visible = false
        selectedPlacedIdx = -1; selElInd.visible = false; setSelectedElement(null)
        hideFootprint()
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeTabRef.current === 'zones') deleteSelectedZone()
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeTabRef.current === 'elements' && selectedPlacedIdx !== -1) {
        scene.remove(placed[selectedPlacedIdx])
        if (lastPlaced === placed[selectedPlacedIdx]) lastPlaced = null
        placed.splice(selectedPlacedIdx, 1)
        selectedPlacedIdx = -1; selElInd.visible = false; setSelectedElement(null)
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && activeTabRef.current === 'terrain') undoPoint()
    }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('dblclick', onDblClick)
    canvas.addEventListener('mouseleave', onMouseLeave)
    canvas.addEventListener('contextmenu', e => e.preventDefault())
    window.addEventListener('keydown', onKeyDown)

    // LABELS
    function updateLabels() {
      mlabels.innerHTML = ''
      const nE = TR.closed ? TR.pts.length : Math.max(0, TR.pts.length - 1)
      for (let i = 0; i < nE; i++) {
        const a = TR.pts[i], b = TR.pts[(i + 1) % TR.pts.length]
        const sp = new THREE.Vector3((a.x + b.x) / 2, 0.5, (a.z + b.z) / 2).project(camera)
        if (sp.z > 1) continue
        const div = document.createElement('div')
        div.className = 'mlabel'
        div.textContent = edgeLen(a, b).toFixed(1) + 'm'
        div.style.left = `${(sp.x + 1) / 2 * wrap.clientWidth}px`
        div.style.top  = `${(1 - (sp.y + 1) / 2) * wrap.clientHeight}px`
        mlabels.appendChild(div)
      }
      zones.forEach(z => {
        const sp = new THREE.Vector3((z.x1 + z.x2) / 2, 0.2, (z.z1 + z.z2) / 2).project(camera)
        if (sp.z > 1) return
        const div = document.createElement('div')
        div.className = 'zlabel'
        div.textContent = ZONE_NAME[z.type]
        div.style.left = `${(sp.x + 1) / 2 * wrap.clientWidth}px`
        div.style.top  = `${(1 - (sp.y + 1) / 2) * wrap.clientHeight}px`
        mlabels.appendChild(div)
      })

      // footprint dimension label
      if (fpHoverPos && currentElementTool && currentElementTool !== 'delete' && FOOTPRINTS[currentElementTool]) {
        const fp = FOOTPRINTS[currentElementTool]
        const dims = toolDimsRef.current ?? fp
        const w = Math.max(0.5, dims.w), d = Math.max(0.5, dims.d)
        const inside = pointInTerrain(fpHoverPos.x, fpHoverPos.z)
        const sp = new THREE.Vector3(fpHoverPos.x, 0.3, fpHoverPos.z).project(camera)
        if (sp.z <= 1) {
          const div = document.createElement('div')
          div.className = inside ? 'fplabel' : 'fplabel out'
          div.textContent = `${w} × ${d} m`
          div.style.left = `${(sp.x + 1) / 2 * wrap.clientWidth}px`
          div.style.top  = `${(1 - (sp.y + 1) / 2) * wrap.clientHeight - 18}px`
          mlabels.appendChild(div)
        }
      }
    }

    // Scene serialisation helpers (used by Sidebar via commandsRef)
    function getSceneData(): ProjectSceneData {
      return {
        v: 1,
        terrain: { pts: [...TR.pts], closed: TR.closed },
        zones: zones.map(z => ({ type: z.type, x1: z.x1, z1: z.z1, x2: z.x2, z2: z.z2 })),
        elements: placed.map(o => ({
          type: o.userData.type as string,
          x: o.position.x, z: o.position.z,
          ry: o.rotation.y, sx: o.scale.x, sz: o.scale.z,
        })),
      }
    }

    function restoreSceneData(data: ProjectSceneData) {
      resetTerrain()
      data.terrain.pts.forEach(p => addPoint(p.x, p.z))
      if (data.terrain.closed && !TR.closed) closeTerrain()
      data.zones.forEach(z => createZone(z.type, z.x1, z.z1, z.x2, z.z2))
      selectZone(-1)
      data.elements.forEach((el, i) => {
        if (creators[el.type]) {
          const obj = creators[el.type](el.x, el.z)
          obj.rotation.y = el.ry
          if (el.sx !== undefined && el.sz !== undefined) obj.scale.set(el.sx, 1, el.sz)
          applyLayering(obj, i, GROUND_COVER_TYPES.has(el.type))
          scene.add(obj); placed.push(obj); lastPlaced = obj
        }
      })
      showStatus(`✅ Carregado — ${data.elements.length} objetos`)
    }

    // WASD / ARROW KEY PAN
    const keysHeld = new Set<string>()
    const onKeyPan = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      keysHeld.add(e.code)
    }
    const onKeyPanUp = (e: KeyboardEvent) => keysHeld.delete(e.code)
    window.addEventListener('keydown', onKeyPan)
    window.addEventListener('keyup',   onKeyPanUp)

    // RENDER LOOP
    let animId: number
    function loop() {
      animId = requestAnimationFrame(loop)

      // WASD pan: move camera target relative to current azimuth
      if (keysHeld.size > 0) {
        const speed = tSph.r * 0.018
        const th = sph.th
        const fx = -Math.sin(th), fz = -Math.cos(th)  // forward direction (XZ)
        const rx =  Math.cos(th), rz = -Math.sin(th)  // right strafe direction
        if (keysHeld.has('KeyW')     || keysHeld.has('ArrowUp'))    { tgtTgt.x += fx * speed; tgtTgt.z += fz * speed }
        if (keysHeld.has('KeyS')     || keysHeld.has('ArrowDown'))  { tgtTgt.x -= fx * speed; tgtTgt.z -= fz * speed }
        if (keysHeld.has('KeyA')     || keysHeld.has('ArrowLeft'))  { tgtTgt.x -= rx * speed; tgtTgt.z -= rz * speed }
        if (keysHeld.has('KeyD')     || keysHeld.has('ArrowRight')) { tgtTgt.x += rx * speed; tgtTgt.z += rz * speed }
      }

      sph.th += (tSph.th - sph.th) * DAMP
      sph.ph += (tSph.ph - sph.ph) * DAMP
      sph.r  += (tSph.r  - sph.r)  * DAMP
      tgt.x  += (tgtTgt.x - tgt.x) * DAMP
      tgt.y  += (tgtTgt.y - tgt.y) * DAMP
      tgt.z  += (tgtTgt.z - tgt.z) * DAMP
      camUpdate(); updateLabels(); renderer.render(scene, camera)
    }
    loop()

    // Load from share link hash if present
    try {
      const hash = window.location.hash
      const m = hash.match(/[#&]share=([^&]+)/)
      if (m) {
        const data = JSON.parse(decodeURIComponent(atob(m[1])))
        restoreSceneData(data)
        showStatus('✅ Projeto carregado do link')
      }
    } catch { /* ignore invalid hash */ }

    // EXPOSE COMMANDS
    commandsRef.current = {
      setupRect,
      closeTerrain,
      undoPoint,
      resetTerrain,
      deleteSelectedZone,
      clearZones: clearZonesInner,
      clearElements: clearElementsInner,
      rotLast,
      camV,
      setZoneTool: (type) => { currentZoneTool = type; setZoneTool(type) },
      setCurrentTool: (tool) => {
        currentElementTool = tool; setCurrentTool(tool)
        fpLastTool = ''; hideFootprint()
        if (tool && tool !== 'delete' && FOOTPRINTS[tool]) {
          const def = FOOTPRINTS[tool]
          setToolDims(def); toolDimsRef.current = def
        } else {
          setToolDims(null); toolDimsRef.current = null
        }
        if (tool) { selectedPlacedIdx = -1; selElInd.visible = false; setSelectedElement(null) }
      },
      cleanupForTabSwitch: () => {
        hoverInd.visible = false; ES.mode = 'idle'
        currentElementTool = null; setCurrentTool(null)
        hideZonePreview(); hideFootprint()
        selectedPlacedIdx = -1; selElInd.visible = false; setSelectedElement(null)
      },
      getSceneData,
      restoreSceneData,
      updateSelectedElement: (ryDeg: number, sx: number, sz: number) => {
        if (selectedPlacedIdx === -1 || !placed[selectedPlacedIdx]) return
        const obj = placed[selectedPlacedIdx]
        obj.rotation.y = ryDeg * Math.PI / 180
        obj.scale.set(sx, 1, sz)
        setSelectedElement({ idx: selectedPlacedIdx, type: obj.userData.type as string, label: obj.userData.label as string, ryDeg, sx, sz })
      },
      deleteSelectedElement: () => {
        if (selectedPlacedIdx === -1 || !placed[selectedPlacedIdx]) return
        const obj = placed[selectedPlacedIdx]
        scene.remove(obj)
        if (lastPlaced === obj) lastPlaced = null
        placed.splice(selectedPlacedIdx, 1)
        selectedPlacedIdx = -1; selElInd.visible = false; setSelectedElement(null)
      },
      getCanvasDataURL: (fmt: 'png' | 'jpeg' = 'png') => {
        renderer.render(scene, camera)
        return canvas.toDataURL(`image/${fmt}`, 0.95)
      },
    }

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onKeyPan)
      window.removeEventListener('keyup',   onKeyPanUp)
      renderer.dispose()
      if (statusTimeout) clearTimeout(statusTimeout)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className={styles.app}>
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        navMode={navMode}
        onNavModeToggle={handleNavToggle}
        terrainStats={terrainStats}
        zoneTool={zoneTool}
        selectedZone={selectedZone}
        currentTool={currentTool}
        toolDims={toolDims}
        onToolDimsChange={handleToolDimsChange}
        selectedElement={selectedElement}
        commands={commandsRef}
        onExport={() => setShowExport(true)}
      />

      <div ref={wrapRef} className={styles.wrap}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div ref={mlabelsRef} className={styles.mlabels} />

        <div className={styles.topbar}>{topbarMsg}</div>

        {statusMsg && (
          <div className={styles.statusbar}>{statusMsg}</div>
        )}

        <button
          className={`${styles.navbtn} ${!navMode ? styles.editMode : ''}`}
          onClick={handleNavToggle}
        >
          {navMode ? '🔓 Navegando' : '✏️ Editando'}
        </button>

        <div className={styles.posbar}>{posText}</div>
      </div>

      {showExport && (
        <ExportPanel commands={commandsRef} onClose={() => setShowExport(false)} />
      )}
    </div>
  )
}
