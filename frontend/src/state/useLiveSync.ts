import { useEffect, useRef } from 'react'
import { ApiError, api } from '../api/client'
import { LIVE } from '../api/config'
import { fromDetail, fromSummary } from '../api/map'
import { followRun } from '../api/stream'
import { DRAFT_ID, useStore } from './store'

const say = (err: unknown) => (err instanceof ApiError ? err.message : 'Could not load. Try again.')

/** Live mode only: load the rooms, load the open room, and follow its run's events. */
export function useLiveSync(signedIn: boolean) {
  const { state, active, dispatch } = useStore()

  // The rooms list, once per login.
  useEffect(() => {
    if (!LIVE || !signedIn) return
    let stale = false
    api
      .rooms()
      .then((rooms) => !stale && dispatch({ type: 'setRooms', sessions: rooms.map((r) => fromSummary(r)) }))
      .catch((err) => {
        if (stale) return
        dispatch({ type: 'setRooms', sessions: [] })
        dispatch({ type: 'setError', block: 'rooms', sessionId: '', message: say(err) })
      })
    return () => {
      stale = true
    }
  }, [signedIn, dispatch])

  // The open room's photo and latest run, the first time it is opened.
  const needsDetail = LIVE && signedIn && active.id !== DRAFT_ID && !active.loaded && !state.roomsLoading
  useEffect(() => {
    if (!needsDetail) return
    let stale = false
    const id = active.id
    api
      .room(id)
      .then((detail) => !stale && dispatch({ type: 'upsertRoom', session: fromDetail(detail, active) }))
      .catch((err) => !stale && dispatch({ type: 'setError', block: 'room', sessionId: id, message: say(err) }))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per room id
  }, [needsDetail, active.id, dispatch])

  // Follow the open room's run: replay its stored events, then keep listening while it runs.
  // After a swap or walk-in on a finished run, listen again from the last event seen.
  const runId = LIVE && signedIn && active.loaded ? active.runId : undefined
  const lastSeq = useRef(0)
  lastSeq.current = active.lastSeq ?? 0
  const followed = useRef<string | undefined>(undefined)
  // Work still owed by the server: a swap in flight or a walk-in being made.
  const pending = useRef(false)
  pending.current = !!state.swapping || active.walkIns.some((w) => w.status === 'making')
  useEffect(() => {
    if (!runId) return
    const id = active.id
    const fresh = followed.current !== runId
    followed.current = runId
    if (fresh) dispatch({ type: 'resetRun', id })
    dispatch({ type: 'setError', block: 'feed', sessionId: id, message: null })
    return followRun(
      runId,
      {
        onEvent: (event) => {
          dispatch({ type: 'runEvent', id, event })
          dispatch({ type: 'setError', block: 'feed', sessionId: id, message: null })
        },
        onTrouble: (message) => dispatch({ type: 'setError', block: 'feed', sessionId: id, message }),
        // The stream closed with work still owed: look again shortly.
        onEnd: () => setTimeout(() => pending.current && dispatch({ type: 'refollow' }), 2000),
      },
      fresh ? 0 : lastSeq.current,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one stream per run, again on refollow
  }, [runId, state.refollow, dispatch])
}
