export type Train = {
  seq: number
  dest: string
  plat: string
  time: string
  minutes: number | null
}

export type LineSchedule = {
  line: string
  status: number | null
  message: string
  url: string | null
  delayed: boolean
  updatedAt: string | null
  up: Train[]
  down: Train[]
  error: string | null
}

type RawTrain = {
  seq?: string
  dest?: string
  plat?: string
  time?: string
}

const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000

export function minutesUntilArrival(time: string, now = new Date()): number | null {
  const match = time.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? 0)
  const arrivalUtc = Date.UTC(year, month - 1, day, hour, minute, second) - HONG_KONG_OFFSET_MS
  if (!Number.isFinite(arrivalUtc)) return null
  const remaining = (arrivalUtc - now.getTime()) / 60000
  if (remaining <= 0) return 0
  return Math.ceil(remaining)
}

type ScheduleBody = {
  status?: number
  message?: string
  url?: string
  isdelay?: string
  Isdelay?: string
  sys_time?: string
  data?: Record<string, { UP?: RawTrain[]; DOWN?: RawTrain[] }>
}

function parseTrains(trains: RawTrain[] | undefined): Train[] {
  return (trains ?? [])
    .map((train) => {
      const time = train.time ?? ""
      return {
        seq: Number(train.seq ?? 0),
        dest: train.dest ?? "",
        plat: train.plat ?? "",
        time,
        minutes: minutesUntilArrival(time),
      }
    })
    .sort((a, b) => a.seq - b.seq)
}

function emptySchedule(line: string, error: string): LineSchedule {
  return {
    line,
    status: null,
    message: "",
    url: null,
    delayed: false,
    updatedAt: null,
    up: [],
    down: [],
    error,
  }
}

export async function fetchLineSchedule(
  line: string,
  station: string,
  signal: AbortSignal,
): Promise<LineSchedule> {
  const url =
    "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php" +
    `?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(station)}&lang=TC`

  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (signal.aborted) throw error
    return emptySchedule(line, "到站資料暫時取不到。請稍後再試。")
  }

  if (response.status === 429) {
    return emptySchedule(line, "官方暫時限制查詢次數，請稍後再按重新整理。")
  }
  if (!response.ok) {
    return emptySchedule(line, "到站資料暫時取不到。請稍後再試。")
  }

  let body: ScheduleBody
  try {
    body = (await response.json()) as ScheduleBody
  } catch (error) {
    if (signal.aborted) throw error
    return emptySchedule(line, "到站資料暫時取不到。請稍後再試。")
  }
  const block = body.data?.[`${line}-${station}`] ?? Object.values(body.data ?? {})[0]
  const delayFlag = body.isdelay ?? body.Isdelay ?? "N"
  const link = body.url && body.url.startsWith("https://") ? body.url : null

  return {
    line,
    status: typeof body.status === "number" ? body.status : null,
    message: body.message ?? "",
    url: link,
    delayed: delayFlag.toUpperCase() === "Y",
    updatedAt: body.sys_time ?? null,
    up: parseTrains(block?.UP),
    down: parseTrains(block?.DOWN),
    error: null,
  }
}

export function notableMessage(message: string): string | null {
  const text = message.trim()
  if (!text || text.toLowerCase() === "successful") return null
  return text
}

export function clockTime(value: string): string {
  const match = value.match(/(\d{2}:\d{2})/)
  return match?.[1] ?? ""
}

export function waitLabel(minutes: number | null): string {
  if (minutes === null) return "時間待定"
  if (minutes <= 0) return "即將開出"
  return `${minutes} 分鐘`
}
