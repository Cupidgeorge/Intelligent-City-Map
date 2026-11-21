import { useMemo, useState } from "react"
import type { Network, Station } from "../types.ts"

type ChromeProps = {
  network: Network
  visibleLines: string[]
  camerasOn: boolean
  cameraCount: number
  cameraState: "loading" | "live" | "backup" | "error"
  onToggleLine: (code: string) => void
  onToggleCameras: () => void
  onPickStation: (station: Station) => void
}

export function Chrome({
  network,
  visibleLines,
  camerasOn,
  cameraCount,
  cameraState,
  onToggleLine,
  onToggleCameras,
  onPickStation,
}: ChromeProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const visible = new Set(visibleLines)

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return []
    return network.stations
      .filter(
        (station) =>
          station.nameZh.includes(query.trim()) || station.nameEn.toLowerCase().includes(text),
      )
      .slice(0, 8)
  }, [network.stations, query])

  const cameraLabel =
    cameraState === "loading"
      ? "快拍點載入中"
      : cameraState === "error"
        ? "快拍清單載入不到"
        : cameraState === "backup"
          ? `快拍 ${cameraCount}（備份清單）`
          : `快拍 ${cameraCount}`

  return (
    <div className="chrome">
      <header className="title-card">
        <p className="eyebrow">香港</p>
        <h1>智慧城市地圖</h1>
        <p className="lede">點車站查看到站班次。放大後點琥珀色快拍點，查看道路最新相片。</p>
        <label className="search">
          <span className="sr-only">搜尋車站</span>
          <input
            value={query}
            placeholder="搜尋車站，例如中環"
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
          />
        </label>
        {open && query.trim() && (
          <ul className="results">
            {matches.length === 0 && <li className="empty-result">找不到這個車站</li>}
            {matches.map((station) => (
              <li key={station.code}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onPickStation(station)
                    setQuery("")
                    setOpen(false)
                  }}
                >
                  <strong>{station.nameZh}</strong>
                  <span>{station.nameEn}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="toggles">
          <button
            type="button"
            className={camerasOn ? "toggle on" : "toggle"}
            aria-pressed={camerasOn}
            onClick={onToggleCameras}
          >
            交通快拍
            <small>{cameraLabel}</small>
          </button>
        </div>
      </header>

      <section className="legend" aria-label="港鐵綫">
        <div className="legend-head">
          <h2>港鐵綫</h2>
          {visibleLines.length === 0 && <p>全部路綫都已隱藏</p>}
        </div>
        <div className="chips">
          {network.lines.map((line) => {
            const on = visible.has(line.code)
            return (
              <button
                key={line.code}
                type="button"
                className={on ? "chip on" : "chip"}
                aria-pressed={on}
                onClick={() => onToggleLine(line.code)}
              >
                <i style={{ background: line.color }} />
                {line.nameZh}
              </button>
            )
          })}
        </div>
        <p className="sources">OpenFreeMap 底圖 · 港鐵班次 · 運輸署快拍 · 地政總署車站位置</p>
      </section>
    </div>
  )
}
