'use client'

import dynamic from 'next/dynamic'

const TerrainApp = dynamic(() => import('@/components/TerrainApp'), { ssr: false })

export default function Home() {
  return <TerrainApp />
}
