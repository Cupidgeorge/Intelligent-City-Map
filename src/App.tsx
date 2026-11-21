import { useEffect, useState } from "react"
import { Chrome } from "./components/Chrome.tsx"
import { DetailPanel } from "./components/DetailPanel.tsx"
import { MapView } from "./components/MapView.tsx"
import { loadCameras } from "./lib/cameras.ts"
import type { Camera, MapFocus, Network, Selection, Station } from "./types.ts"

type CameraState = "loading" | "live" | "backup" | "error"

export default function App() {
  const [network, setNetwork] = useState<Network | null>(null)
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [cameras, setCameras] = useState<Camera[]>([])
  const [cameraState, setCameraState] = useState<CameraState>("loading")
  const [visibleLines, setVisibleLines] = useState<string[]>([])
  const [camerasOn, setCamerasOn] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [basemapProblem, setBasemapProblem] = useState(false)

  useEffect(() => {
    void fetch("/data/network.json")
      .then((response) => {
        if (!response.ok) throw new Error("network")
        return response.json() as Promise<Network>
      })
      .then((data) => {
        setNetwork(data)
        setVisibleLines(data.lines.map((line) => line.code))
      })
      .catch(() => setNetworkError("港鐵路線資料暫時載入不到。請重新整理頁面。"))
  }, [])

  useEffect(() => {
    void loadCameras()
      .then((result) => {
        setCameras(result.cameras)
        setCameraState(result.live ? "live" : "backup")
      })
      .catch(() => setCameraState("error"))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function pickStation(station: Station) {
    setSelection({ type: "station", code: station.code })
    setFocus({ lon: station.lon, lat: station.lat, zoom: 15, token: Date.now() })
  }

  if (networkError) {
    return (
      <main className="boot">
        <h1>香港智慧城市地圖</h1>
        <p>{networkError}</p>
      </main>
    )
  }

  if (!network) {
    return (
      <main className="boot">
        <h1>香港智慧城市地圖</h1>
        <p>正在準備港鐵網絡…</p>
      </main>
    )
  }

  return (
    <main className={selection ? "app panel-open" : "app"}>
      <MapView
        network={network}
        cameras={cameras}
        camerasVisible={camerasOn}
        visibleLines={visibleLines}
        selection={selection}
        focus={focus}
        onSelectStation={(code) => setSelection({ type: "station", code })}
        onSelectCamera={(key) => setSelection({ type: "camera", key })}
        onClear={() => setSelection(null)}
        onBasemapProblem={() => setBasemapProblem(true)}
      />
      <Chrome
        network={network}
        visibleLines={visibleLines}
        camerasOn={camerasOn}
        cameraCount={cameras.length}
        cameraState={cameraState}
        onToggleLine={(code) =>
          setVisibleLines((current) =>
            current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
          )
        }
        onToggleCameras={() => setCamerasOn((current) => !current)}
        onPickStation={pickStation}
      />
      {selection && (
        <DetailPanel
          network={network}
          cameras={cameras}
          selection={selection}
          onClose={() => setSelection(null)}
        />
      )}
      {basemapProblem && (
        <p className="basemap-banner" role="status">
          底圖暫時載入不到。OpenFreeMap 沒有回應，請稍後重新整理頁面。
        </p>
      )}
      {cameraState === "error" && (
        <p className="basemap-banner second" role="status">
          交通快拍清單暫時載入不到。車站和到站班次仍可使用。
        </p>
      )}
    </main>
  )
}
