import type { FeatureCollection, LineString, Point } from "geojson"
import type { Camera, Network, RailLine, Station } from "../types.ts"

export function lineMap(network: Network): Map<string, RailLine> {
  return new Map(network.lines.map((line) => [line.code, line]))
}

export function stationMap(network: Network): Map<string, Station> {
  return new Map(network.stations.map((station) => [station.code, station]))
}

export function lineFeatures(network: Network): FeatureCollection<LineString> {
  const stations = stationMap(network)
  const features: FeatureCollection<LineString>["features"] = []

  for (const line of network.lines) {
    const curved = (line.tracks ?? []).filter((track) => track.length >= 2)
    const pieces = curved.length
      ? curved
      : line.paths.map((path) =>
          path.flatMap((code) => {
            const station = stations.get(code)
            return station ? [[station.lon, station.lat] as [number, number]] : []
          }),
        )
    pieces.forEach((coordinates, index) => {
      if (coordinates.length < 2) return
      features.push({
        type: "Feature",
        id: `${line.code}-${index}`,
        properties: {
          code: line.code,
          nameZh: line.nameZh,
          color: line.color,
          offset: curved.length ? 0 : line.offset,
        },
        geometry: { type: "LineString", coordinates },
      })
    })
  }

  return { type: "FeatureCollection", features }
}

export function stationFeatures(network: Network): FeatureCollection<Point> {
  const lines = lineMap(network)
  return {
    type: "FeatureCollection",
    features: network.stations.map((station) => {
      const primary = lines.get(station.lines[0] ?? "")
      return {
        type: "Feature",
        id: station.code,
        properties: {
          code: station.code,
          nameZh: station.nameZh,
          nameEn: station.nameEn,
          lineList: `,${station.lines.join(",")},`,
          color: station.lines.length > 1 ? "#ffffff" : (primary?.color ?? "#172026"),
          interchange: station.lines.length > 1,
        },
        geometry: { type: "Point", coordinates: [station.lon, station.lat] },
      }
    }),
  }
}

export function cameraFeatures(cameras: Camera[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: cameras.map((camera) => ({
      type: "Feature",
      id: camera.key,
      properties: {
        key: camera.key,
        description: camera.description,
      },
      geometry: { type: "Point", coordinates: [camera.lon, camera.lat] },
    })),
  }
}
