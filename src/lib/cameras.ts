import type { Camera, CameraFile } from "../types.ts"

const LIVE_URL =
  "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv"

const IMAGE_URL = /^https:\/\/tdcctv\.data\.one\.gov\.hk\/[A-Za-z0-9]+\.jpe?g$/i

export function cameraImageUrl(url: string, refreshToken: number): string | null {
  if (!IMAGE_URL.test(url)) return null
  if (refreshToken === 0) return url
  return `${url}?t=${refreshToken}`
}

function cleanDescription(description: string, key: string): string {
  const suffix = `[${key}]`
  const text = description.trim()
  return text.endsWith(suffix) ? text.slice(0, -suffix.length).trim() : text
}

export function parseCameraCsv(text: string): Camera[] {
  const cleaned = text.replace(/^\uFEFF+/, "")
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const header = lines[0]?.split("\t") ?? []
  const index = Object.fromEntries(header.map((name, position) => [name.trim(), position]))
  const cameras: Camera[] = []

  for (const line of lines.slice(1)) {
    const cells = line.split("\t")
    const key = cells[index.key]?.trim()
    const url = cells[index.url]?.trim()
    const lat = Number(cells[index.latitude])
    const lon = Number(cells[index.longitude])
    if (!key || !url || Number.isNaN(lat) || Number.isNaN(lon)) continue
    if (lat < 22.1 || lat > 22.6 || lon < 113.8 || lon > 114.5) continue
    if (!IMAGE_URL.test(url)) continue
    cameras.push({
      key,
      region: cells[index.region]?.trim() ?? "",
      district: cells[index.district]?.trim() ?? "",
      description: cleanDescription(cells[index.description] ?? "", key),
      lon,
      lat,
      url,
    })
  }

  return cameras
}

export async function loadCameras(): Promise<{ cameras: Camera[]; live: boolean }> {
  try {
    const response = await fetch(LIVE_URL, { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`camera list ${response.status}`)
    const text = new TextDecoder("utf-16").decode(await response.arrayBuffer())
    const cameras = parseCameraCsv(text)
    if (cameras.length < 900) throw new Error("camera list was too short")
    return { cameras, live: true }
  } catch {
    const response = await fetch("/data/cameras.json")
    if (!response.ok) throw new Error("backup camera list missing")
    const file = (await response.json()) as CameraFile
    return { cameras: file.cameras, live: false }
  }
}
