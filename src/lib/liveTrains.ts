import { fetchLineSchedule, type LineSchedule, type Train } from "./schedule.ts"
import type { Network, Station } from "../types.ts"

export type TrainMarker = {
  id: string
  line: string
  color: string
  destName: string
  nextName: string
  minutes: number
  runSeconds: number
  fraction: number
  updatedAt: number
  coords: [number, number][]
}

type Stop = { code: string; along: number }
type Segment = {
  line: string
  color: string
  from: string
  to: string
  coords: [number, number][]
  lengthM: number
  runSeconds: number
}

const SPEED_MPS = 11.5

function meters(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180)
  const dx = (b[0] - a[0]) * (Math.PI / 180) * Math.cos(lat) * 6_371_000
  const dy = (b[1] - a[1]) * (Math.PI / 180) * 6_371_000
  return Math.hypot(dx, dy)
}

function locate(point: [number, number], line: [number, number][]) {
  let best = Number.POSITIVE_INFINITY
  let along = 0
  let walked = 0
  for (let index = 0; index < line.length - 1; index += 1) {
    const start = line[index]
    const end = line[index + 1]
    const abx = end[0] - start[0]
    const aby = end[1] - start[1]
    const len2 = abx * abx + aby * aby
    const t =
      len2 === 0
        ? 0
        : Math.min(1, Math.max(0, ((point[0] - start[0]) * abx + (point[1] - start[1]) * aby) / len2))
    const projected: [number, number] = [start[0] + abx * t, start[1] + aby * t]
    const distance = meters(point, projected)
    const span = meters(start, end)
    if (distance < best) {
      best = distance
      along = walked + span * t
    }
    walked += span
  }
  return { distance: best, along }
}

function sliceTrack(line: [number, number][], start: number, end: number): [number, number][] {
  const reverse = end < start
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const points: [number, number][] = []
  let walked = 0
  for (let index = 0; index < line.length - 1; index += 1) {
    const a = line[index]
    const b = line[index + 1]
    const span = meters(a, b)
    const next = walked + span
    if (next >= from && walked <= to && span > 0) {
      const t0 = Math.max(0, (from - walked) / span)
      const t1 = Math.min(1, (to - walked) / span)
      const point = (t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      if (points.length === 0) points.push(point(t0))
      points.push(point(t1))
    }
    walked = next
  }
  return reverse ? points.reverse() : points
}

function buildSegments(network: Network): Segment[] {
  const stations = new Map(network.stations.map((station) => [station.code, station]))
  const segments: Segment[] = []
  const seen = new Set<string>()

  for (const line of network.lines) {
    for (const path of line.paths) {
      const tracks = (line.tracks ?? []).filter((track) => track.length >= 2)
      let best: { score: number; stops: Stop[]; track: [number, number][] } | null = null
      for (const track of tracks) {
        const stops: Stop[] = []
        let score = 0
        for (const code of path) {
          const station = stations.get(code)
          if (!station) continue
          const hit = locate([station.lon, station.lat], track)
          if (hit.distance > 450) continue
          stops.push({ code, along: hit.along })
          score += hit.distance
        }
        if (stops.length >= 2 && (best === null || stops.length > best.stops.length || score < best.score)) {
          best = { score, stops, track }
        }
      }
      if (!best) continue
      const ordered = [...best.stops].sort((a, b) => a.along - b.along)
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const from = ordered[index]
        const to = ordered[index + 1]
        const key = `${line.code}:${from.code}:${to.code}`
        if (seen.has(key)) continue
        seen.add(key)
        const forward = sliceTrack(best.track, from.along, to.along)
        if (forward.length < 2) continue
        const lengthM = forward
          .slice(1)
          .reduce((total, point, pointIndex) => total + meters(forward[pointIndex], point), 0)
        if (lengthM < 80) continue
        const runSeconds = Math.max(75, lengthM / SPEED_MPS)
        segments.push(
          {
            line: line.code,
            color: line.color,
            from: from.code,
            to: to.code,
            coords: forward,
            lengthM,
            runSeconds,
          },
          {
            line: line.code,
            color: line.color,
            from: to.code,
            to: from.code,
            coords: [...forward].reverse(),
            lengthM,
            runSeconds,
          },
        )
      }
    }
  }
  return segments
}

function adjacency(segments: Segment[]): Map<string, Map<string, string[]>> {
  const graph = new Map<string, Map<string, string[]>>()
  for (const segment of segments) {
    const line = graph.get(segment.line) ?? new Map<string, string[]>()
    line.set(segment.from, [...(line.get(segment.from) ?? []), segment.to])
    line.set(segment.to, [...(line.get(segment.to) ?? []), segment.from])
    graph.set(segment.line, line)
  }
  return graph
}

function ahead(from: string, to: string, neighbors: Map<string, string[]>): Set<string> {
  const reachable = new Set<string>([to])
  const seen = new Set<string>([from, to])
  const queue = [to]
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) break
    for (const next of neighbors.get(node) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      reachable.add(next)
      queue.push(next)
    }
  }
  return reachable
}

function soonest(trains: Train[], allowed: Set<string>): Train | null {
  return trains
    .filter((train) => train.minutes !== null && allowed.has(train.dest))
    .sort((a, b) => (a.minutes ?? 99) - (b.minutes ?? 99))[0] ?? null
}

type StationSchedule = LineSchedule & { station: string }

export function placeTrains(
  network: Network,
  schedules: StationSchedule[],
  names: Map<string, Station>,
  now = Date.now(),
): TrainMarker[] {
  const segments = buildSegments(network)
  const graph = adjacency(segments)
  const markers: TrainMarker[] = []

  for (const segment of segments) {
    const schedule = schedules.find((item) => item.line === segment.line && item.station === segment.to)
    if (!schedule || schedule.error) continue
    const allowed = ahead(segment.from, segment.to, graph.get(segment.line) ?? new Map())
    const train = soonest([...schedule.up, ...schedule.down], allowed)
    if (!train || train.minutes === null) continue
    const eta = train.minutes * 60
    if (eta > segment.runSeconds) continue
    const fraction = Math.min(0.96, Math.max(0.04, 1 - eta / segment.runSeconds))
    markers.push({
      id: `${segment.line}:${segment.from}:${segment.to}:${train.dest}`,
      line: segment.line,
      color: segment.color,
      destName: names.get(train.dest)?.nameZh ?? train.dest,
      nextName: names.get(segment.to)?.nameZh ?? segment.to,
      minutes: train.minutes,
      runSeconds: segment.runSeconds,
      fraction,
      updatedAt: now,
      coords: segment.coords,
    })
  }
  return markers
}

async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export async function pollTrains(network: Network, signal: AbortSignal): Promise<TrainMarker[]> {
  const names = new Map(network.stations.map((station) => [station.code, station]))
  const queries = network.lines.flatMap((line) =>
    [...new Set(line.paths.flat())].map((code) => ({ line: line.code, code })),
  )
  const schedules: StationSchedule[] = await pool(queries, 4, async (query) => {
    const schedule = await fetchLineSchedule(query.line, query.code, signal)
    return { ...schedule, station: query.code }
  })
  return placeTrains(network, schedules, names)
}

export function trainPoint(marker: TrainMarker, at = Date.now()): { lon: number; lat: number; bearing: number } {
  const elapsed = Math.max(0, (at - marker.updatedAt) / 1000)
  const fraction = Math.min(0.97, marker.fraction + elapsed / marker.runSeconds)
  const total = marker.coords.slice(1).reduce((sum, point, index) => sum + meters(marker.coords[index], point), 0)
  let target = total * fraction
  for (let index = 0; index < marker.coords.length - 1; index += 1) {
    const start = marker.coords[index]
    const end = marker.coords[index + 1]
    const span = meters(start, end)
    if (target <= span || index === marker.coords.length - 2) {
      const t = span === 0 ? 0 : Math.min(1, target / span)
      const lon = start[0] + (end[0] - start[0]) * t
      const lat = start[1] + (end[1] - start[1]) * t
      const y = Math.sin(((end[0] - start[0]) * Math.PI) / 180) * Math.cos((end[1] * Math.PI) / 180)
      const x =
        Math.cos((start[1] * Math.PI) / 180) * Math.sin((end[1] * Math.PI) / 180) -
        Math.sin((start[1] * Math.PI) / 180) *
          Math.cos((end[1] * Math.PI) / 180) *
          Math.cos(((end[0] - start[0]) * Math.PI) / 180)
      const bearing = (Math.atan2(y, x) * 180) / Math.PI
      return { lon, lat, bearing: (bearing + 360) % 360 }
    }
    target -= span
  }
  const last = marker.coords[marker.coords.length - 1]
  return { lon: last[0], lat: last[1], bearing: 0 }
}
