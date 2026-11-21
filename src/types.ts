export type Station = {
  code: string
  nameZh: string
  nameEn: string
  lon: number
  lat: number
  lines: string[]
  offRoute: boolean
}

export type RailLine = {
  code: string
  nameZh: string
  nameEn: string
  color: string
  offset: number
  paths: string[][]
}

export type Network = {
  generatedAt: string
  coordinateSource: string
  lineSource: string
  stations: Station[]
  lines: RailLine[]
}

export type Camera = {
  key: string
  region: string
  district: string
  description: string
  lon: number
  lat: number
  url: string
}

export type CameraFile = {
  fetchedAt: string
  source: string
  cameras: Camera[]
}

export type Selection =
  | { type: "station"; code: string }
  | { type: "camera"; key: string }

export type MapFocus = {
  lon: number
  lat: number
  zoom: number
  token: number
}
