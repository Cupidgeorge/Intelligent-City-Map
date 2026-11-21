import { useEffect, useRef, useState } from "react"
import { GeoJSONSource, Map, NavigationControl, setWorkerUrl } from "maplibre-gl"
import type { FilterSpecification, MapMouseEvent } from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import { cameraFeatures, lineFeatures, stationFeatures } from "../lib/geo.ts"
import type { Camera, MapFocus, Network, Selection } from "../types.ts"

setWorkerUrl(workerUrl)

const STYLE = "https://tiles.openfreemap.org/styles/liberty"
const INTERACTIVE = ["stations", "cameras", "camera-clusters"]

type MapViewProps = {
  network: Network
  cameras: Camera[]
  camerasVisible: boolean
  visibleLines: string[]
  selection: Selection | null
  focus: MapFocus | null
  onSelectStation: (code: string) => void
  onSelectCamera: (key: string) => void
  onClear: () => void
  onBasemapProblem: () => void
  onBasemapReady: () => void
}

function lineFilter(visibleLines: string[]): FilterSpecification {
  if (visibleLines.length === 0) return ["==", ["get", "code"], ""]
  return ["in", ["get", "code"], ["literal", visibleLines]]
}

function stationFilter(visibleLines: string[]): FilterSpecification {
  if (visibleLines.length === 0) return ["==", ["get", "code"], ""]
  return [
    "any",
    ...visibleLines.map((code) => ["in", `,${code},`, ["get", "lineList"]]),
  ] as FilterSpecification
}

export function MapView({
  network,
  cameras,
  camerasVisible,
  visibleLines,
  selection,
  focus,
  onSelectStation,
  onSelectCamera,
  onClear,
  onBasemapProblem,
  onBasemapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const camerasRef = useRef(cameras)
  const camerasOnRef = useRef(camerasVisible)
  const [mapReady, setMapReady] = useState(false)
  const handlers = useRef({
    onSelectStation,
    onSelectCamera,
    onClear,
    onBasemapProblem,
    onBasemapReady,
  })
  camerasRef.current = cameras
  camerasOnRef.current = camerasVisible
  handlers.current = { onSelectStation, onSelectCamera, onClear, onBasemapProblem, onBasemapReady }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new Map({
      container,
      style: STYLE,
      center: [114.17, 22.33],
      zoom: 10.35,
      minZoom: 9,
      maxZoom: 18,
      maxBounds: [
        [113.72, 22.12],
        [114.52, 22.6],
      ],
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ showCompass: false }), "top-right")
    mapRef.current = map

    map.on("error", (event) => {
      const message = event.error instanceof Error ? event.error.message : ""
      if (!map.isStyleLoaded() && /style|failed to fetch|network/i.test(message)) {
        handlers.current.onBasemapProblem()
      }
    })

    map.on("load", () => {
      handlers.current.onBasemapReady()
      map.addSource("mtr-lines", { type: "geojson", data: lineFeatures(network) })
      map.addSource("stations", { type: "geojson", data: stationFeatures(network) })
      map.addSource("cameras", {
        type: "geojson",
        data: cameraFeatures(camerasRef.current),
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 13,
      })

      map.addLayer({
        id: "mtr-casing",
        type: "line",
        source: "mtr-lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#fffdf8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 5, 13, 8, 16, 12],
          "line-offset": ["get", "offset"],
          "line-opacity": 0.95,
        },
      })
      map.addLayer({
        id: "mtr-lines",
        type: "line",
        source: "mtr-lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.4, 13, 4.2, 16, 6.5],
          "line-offset": ["get", "offset"],
        },
      })
      map.addLayer({
        id: "camera-clusters",
        type: "circle",
        source: "cameras",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#c2410c",
          "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 80, 23],
          "circle-stroke-color": "#fffdf8",
          "circle-stroke-width": 2,
        },
      })
      map.addLayer({
        id: "camera-counts",
        type: "symbol",
        source: "cameras",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
        },
        paint: { "text-color": "#fffdf8" },
      })
      map.addLayer({
        id: "cameras",
        type: "circle",
        source: "cameras",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#c2410c",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 15, 6],
          "circle-stroke-color": "#fffdf8",
          "circle-stroke-width": 1.5,
        },
      })
      map.addLayer({
        id: "stations",
        type: "circle",
        source: "stations",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            ["case", ["get", "interchange"], 4.5, 3.5],
            14,
            ["case", ["get", "interchange"], 8, 6],
          ],
          "circle-stroke-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#0f6e78",
            ["get", "interchange"],
            "#172026",
            "#fffdf8",
          ],
          "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.6],
        },
      })
      map.addLayer({
        id: "station-labels",
        type: "symbol",
        source: "stations",
        minzoom: 12,
        layout: {
          "text-field": ["get", "nameZh"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, 1.15],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "text-color": "#172026",
          "text-halo-color": "#fffdf8",
          "text-halo-width": 1.4,
        },
      })

      setMapReady(true)
    })

    map.on("click", (event: MapMouseEvent) => {
      if (!map.getLayer("stations")) return
      const station = map.queryRenderedFeatures(event.point, { layers: ["stations"] })[0]
      const stationCode = station?.properties?.code
      if (typeof stationCode === "string") {
        handlers.current.onSelectStation(stationCode)
        return
      }

      if (camerasOnRef.current) {
        const cameraHit = map.queryRenderedFeatures(event.point, { layers: ["cameras"] })[0]
        const cameraKey = cameraHit?.properties?.key
        if (typeof cameraKey === "string") {
          handlers.current.onSelectCamera(cameraKey)
          return
        }
      }

      const cluster = camerasOnRef.current
        ? map.queryRenderedFeatures(event.point, { layers: ["camera-clusters"] })[0]
        : undefined
      const clusterId = cluster?.properties?.cluster_id
      if (cluster && typeof clusterId === "number" && cluster.geometry.type === "Point") {
        const [lon, lat] = cluster.geometry.coordinates
        const source = map.getSource("cameras")
        if (source instanceof GeoJSONSource && typeof lon === "number" && typeof lat === "number") {
          void source.getClusterExpansionZoom(clusterId).then((zoom) => {
            map.easeTo({ center: [lon, lat], zoom })
          })
        }
        return
      }

      handlers.current.onClear()
    })

    map.on("mousemove", (event: MapMouseEvent) => {
      if (!map.getLayer("stations")) return
      const layers = camerasOnRef.current ? INTERACTIVE : ["stations"]
      const hits = map.queryRenderedFeatures(event.point, { layers })
      map.getCanvas().style.cursor = hits.length > 0 ? "pointer" : ""
    })

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      setMapReady(false)
      map.remove()
      mapRef.current = null
    }
    // The map is created once. Later data changes go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const lines = lineFilter(visibleLines)
    const stations = stationFilter(visibleLines)
    const cameraVisibility = camerasVisible ? "visible" : "none"
    map.setFilter("mtr-lines", lines)
    map.setFilter("mtr-casing", lines)
    map.setFilter("stations", stations)
    map.setFilter("station-labels", stations)
    map.setLayoutProperty("cameras", "visibility", cameraVisibility)
    map.setLayoutProperty("camera-clusters", "visibility", cameraVisibility)
    map.setLayoutProperty("camera-counts", "visibility", cameraVisibility)
  }, [camerasVisible, mapReady, visibleLines])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource("cameras")
    if (!map || !mapReady || !(source instanceof GeoJSONSource)) return
    source.setData(cameraFeatures(cameras))
  }, [cameras, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !focus) return
    map.flyTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(map.getZoom(), focus.zoom),
      essential: true,
    })
  }, [focus, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const selectedId = selection?.type === "station" ? selection.code : undefined
    for (const station of network.stations) {
      map.setFeatureState(
        { source: "stations", id: station.code },
        { selected: station.code === selectedId },
      )
    }
  }, [mapReady, network.stations, selection])

  return <div ref={containerRef} className="map" />
}
