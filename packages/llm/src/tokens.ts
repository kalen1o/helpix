// A rough token estimate without shipping a tokenizer. CJK characters are about one token each; other text averages
// about four characters per token. Callers use it to stay under provider limits, so rounding up is deliberate.
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

export function charTokens(ch: string): number {
  return WIDE.test(ch) ? 1 : 0.25
}

export function estimateTokens(text: string): number {
  let n = 0
  for (const ch of text) n += charTokens(ch)
  return Math.ceil(n)
}
