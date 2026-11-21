export type Train = {
  seq: number
  dest: string
  plat: string
  time: string
  ttnt: number | null
  confirmed: boolean
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
  ttnt?: string
  valid?: string
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
      const minutes = Number(train.ttnt)
      return {
        seq: Number(train.seq ?? 0),
        dest: train.dest ?? "",
        plat: train.plat ?? "",
        time: train.time ?? "",
        ttnt: Number.isFinite(minutes) ? minutes : null,
        confirmed: (train.valid ?? "Y").toUpperCase() === "Y",
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

  const body = (await response.json()) as ScheduleBody
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
