import { useEffect, useState } from "react"
import { cameraImageUrl } from "../lib/cameras.ts"
import { lineMap, stationMap } from "../lib/geo.ts"
import {
  clockTime,
  fetchLineSchedule,
  notableMessage,
  waitLabel,
  type LineSchedule,
  type Train,
} from "../lib/schedule.ts"
import type { Camera, Network, Selection } from "../types.ts"

type DetailPanelProps = {
  network: Network
  cameras: Camera[]
  selection: Selection
  onClose: () => void
}

export function DetailPanel({ network, cameras, selection, onClose }: DetailPanelProps) {
  return (
    <aside className="panel" aria-live="polite">
      <button type="button" className="close" onClick={onClose}>
        關閉
      </button>
      {selection.type === "station" ? (
        <StationDetail network={network} code={selection.code} />
      ) : (
        <CameraDetail cameras={cameras} cameraKey={selection.key} />
      )}
    </aside>
  )
}

function StationDetail({ network, code }: { network: Network; code: string }) {
  const station = stationMap(network).get(code)
  const lines = lineMap(network)
  const [refresh, setRefresh] = useState(0)
  const requestKey = `${code}:${refresh}`
  const [result, setResult] = useState<{ key: string; schedules: LineSchedule[] }>({
    key: "",
    schedules: [],
  })
  const loading = result.key !== requestKey
  const schedules = result.key === requestKey ? result.schedules : []

  useEffect(() => {
    if (!station) return
    const controller = new AbortController()
    const key = `${station.code}:${refresh}`
    void Promise.all(
      station.lines.map(async (line) => {
        try {
          return await fetchLineSchedule(line, station.code, controller.signal)
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
            throw error
          }
          return {
            line,
            status: null,
            message: "",
            url: null,
            delayed: false,
            updatedAt: null,
            up: [],
            down: [],
            error: "到站資料暫時取不到。請稍後再試。",
          }
        }
      }),
    )
      .then((schedules) => {
        if (!controller.signal.aborted) setResult({ key, schedules })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return
        }
        setResult({
          key,
          schedules: station.lines.map((line) => ({
            line,
            status: null,
            message: "",
            url: null,
            delayed: false,
            updatedAt: null,
            up: [],
            down: [],
            error: "到站資料暫時取不到。請稍後再試。",
          })),
        })
      })

    return () => controller.abort()
  }, [station, refresh])

  if (!station) {
    return (
      <div className="panel-body">
        <h2>找不到這個車站</h2>
        <p>車站清單裡沒有這個代碼。</p>
      </div>
    )
  }

  const delayed = schedules.some((schedule) => schedule.delayed)
  const updatedAt = schedules.find((schedule) => schedule.updatedAt)?.updatedAt

  return (
    <div className="panel-body">
      <p className="eyebrow">港鐵車站</p>
      <h2>{station.nameZh}</h2>
      <p className="en">{station.nameEn}</p>
      <div className="line-pills">
        {station.lines.map((code) => {
          const line = lines.get(code)
          return (
            <span key={code} className="pill">
              <i style={{ background: line?.color ?? "#172026" }} />
              {line?.nameZh ?? code}
            </span>
          )
        })}
      </div>
      {station.offRoute && (
        <p className="note">
          馬場站不在港鐵路綫檔的日常車站次序裡，所以東鐵綫不會畫經這裡。
        </p>
      )}
      {delayed && <p className="warn">港鐵表示列車服務有延誤。</p>}
      {updatedAt && <p className="meta">港鐵更新時間 {updatedAt}</p>}
      {loading && schedules.length === 0 && <p className="meta">正在查到站班次…</p>}

      {schedules.map((schedule) => (
        <LineBlock
          key={schedule.line}
          schedule={schedule}
          lineName={lines.get(schedule.line)?.nameZh ?? schedule.line}
          color={lines.get(schedule.line)?.color ?? "#172026"}
          names={stationMap(network)}
        />
      ))}

      <button type="button" className="refresh" onClick={() => setRefresh((value) => value + 1)}>
        {loading ? "更新中…" : "重新整理班次"}
      </button>
    </div>
  )
}

function LineBlock({
  schedule,
  lineName,
  color,
  names,
}: {
  schedule: LineSchedule
  lineName: string
  color: string
  names: Map<string, { nameZh: string }>
}) {
  const nameOf = (code: string) => names.get(code)?.nameZh ?? code
  const bothEmpty = schedule.up.length === 0 && schedule.down.length === 0
  const message = notableMessage(schedule.message)

  return (
    <section className="line-block">
      <h3>
        <i style={{ background: color }} />
        {lineName}
      </h3>
      {schedule.error && <p className="warn">{schedule.error}</p>}
      {!schedule.error && schedule.status === 0 && (
        <>
          <p>官方沒有這組路綫和車站的班次資料。</p>
          {message && <p className="meta">{message}</p>}
        </>
      )}
      {!schedule.error && schedule.status === 1 && bothEmpty && (
        <p>官方回覆成功，但現在沒有即將到站的班次。</p>
      )}
      {schedule.up.length > 0 && (
        <TrainList title={directionTitle(schedule.up, nameOf)} trains={schedule.up} nameOf={nameOf} />
      )}
      {schedule.down.length > 0 && (
        <TrainList
          title={directionTitle(schedule.down, nameOf)}
          trains={schedule.down}
          nameOf={nameOf}
        />
      )}
      {!schedule.error && schedule.status === 1 && !bothEmpty && (schedule.up.length === 0 || schedule.down.length === 0) && (
        <p className="meta">另一方向現在沒有班次。若這裡是終點站，列車不會再開出。</p>
      )}
      {!schedule.error && message && schedule.status !== 0 && <p className="note">{message}</p>}
      {schedule.url && (
        <a href={schedule.url} target="_blank" rel="noreferrer">
          特別安排詳情
        </a>
      )}
    </section>
  )
}

function directionTitle(trains: Train[], nameOf: (code: string) => string): string {
  const destinations = [...new Set(trains.map((train) => train.dest).filter(Boolean))]
  if (destinations.length === 0) return "即將到站"
  return destinations.map((code) => `往${nameOf(code)}`).join("／")
}

function TrainList({
  title,
  trains,
  nameOf,
}: {
  title: string
  trains: Train[]
  nameOf: (code: string) => string
}) {
  return (
    <div className="trains">
      <h4>{title}</h4>
      <ul>
        {trains.map((train) => (
          <li key={`${train.seq}-${train.dest}-${train.time}`}>
            <strong>{waitLabel(train.minutes)}</strong>
            <span>
              {train.dest ? `往${nameOf(train.dest)}` : "目的地待定"}
              {train.plat ? ` · 月台 ${train.plat}` : ""}
            </span>
            {clockTime(train.time) && <time>{clockTime(train.time)}</time>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CameraDetail({ cameras, cameraKey }: { cameras: Camera[]; cameraKey: string }) {
  const camera = cameras.find((item) => item.key === cameraKey)
  const [refresh, setRefresh] = useState(0)
  const [failure, setFailure] = useState<{ key: string; refresh: number } | null>(null)
  const failed = failure?.key === cameraKey && failure.refresh === refresh

  if (!camera) {
    return (
      <div className="panel-body">
        <h2>找不到這個快拍點</h2>
        <p>它不在目前的運輸署清單裡。</p>
      </div>
    )
  }

  const src = cameraImageUrl(camera.url, refresh)

  return (
    <div className="panel-body">
      <p className="eyebrow">交通快拍</p>
      <h2>{camera.description || camera.key}</h2>
      <p className="meta">
        {camera.region} · {camera.district} · {camera.key}
      </p>
      {src && !failed ? (
        <img
          src={src}
          alt={camera.description || `快拍點 ${camera.key}`}
          width={320}
          height={240}
          onError={() => setFailure({ key: cameraKey, refresh })}
        />
      ) : (
        <p className="warn">
          相片暫時載入不到。運輸署可能正在維修，或這個快拍點暫時未能提供服務。
        </p>
      )}
      <p className="note">
        相片約 320×240，運輸署約每兩分鐘更新。若圖片顯示「暫時未能提供服務」，代表這個位置現時沒有畫面。
      </p>
      <button
        type="button"
        className="refresh"
        onClick={() => setRefresh((value) => (value === 0 ? Date.now() : value + 1))}
      >
        重新整理相片
      </button>
    </div>
  )
}
