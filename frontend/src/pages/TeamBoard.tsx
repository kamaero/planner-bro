import { Button } from '@/components/ui/button'

const TEAM_ROOM_ID = 'plannerbro_team_whiteboard'
const TEAM_ROOM_KEY = 'plannerbro_room_key_220'

function buildTeamBoardUrl() {
  const url = new URL('/excalidraw/', window.location.origin)
  url.hash = `room=${TEAM_ROOM_ID},${TEAM_ROOM_KEY}`
  return url.toString()
}

export function TeamBoard() {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="rounded-2xl border bg-card p-6">
        <h1 className="text-2xl font-bold mb-3">Доска команды</h1>
        <p className="text-muted-foreground mb-6">
          Единая доска для всей команды. Все участники работают в одном общем пространстве.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              window.location.assign(buildTeamBoardUrl())
            }}
          >
            Открыть общую доску
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.open(buildTeamBoardUrl(), '_blank', 'noopener,noreferrer')
            }}
          >
            Открыть в новой вкладке
          </Button>
        </div>
      </div>
    </div>
  )
}
