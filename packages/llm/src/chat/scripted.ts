import type { ChatEvent, ChatProvider, ChatRequest } from './types'

export type ScriptedRound = (ChatEvent | Error)[]

export interface ScriptedChat extends ChatProvider {
  /** Every request received, in order (messages copied at call time). */
  readonly requests: ChatRequest[]
}

/**
 * A test double: call N replays round N (or what the function returns for it). An Error item is thrown at that point
 * in the stream, after the events before it have been yielded.
 */
export function createScriptedChat(
  rounds: ScriptedRound[] | ((req: ChatRequest, call: number) => ScriptedRound),
  model = 'scripted',
): ScriptedChat {
  const requests: ChatRequest[] = []
  return {
    defaultModel: model,
    requests,
    async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
      const call = requests.length
      requests.push({ ...req, messages: [...req.messages] })
      const round = typeof rounds === 'function' ? rounds(req, call) : rounds[call]
      if (!round) throw new Error(`createScriptedChat: no round scripted for call ${call}`)
      for (const item of round) {
        if (item instanceof Error) throw item
        yield item
      }
    },
  }
}
