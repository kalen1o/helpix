import { Document, Packer, Paragraph } from 'docx'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/** A one-page PDF with each line drawn as real text (extractable, like an exported document). */
export async function makePdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage()
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 700 - i * 20, size: 12, font }))
  return Buffer.from(await doc.save())
}

export async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: paragraphs.map((p) => new Paragraph(p)) }] })
  return Packer.toBuffer(doc)
}

/** `words` unique words (w0, w1, …) in sentences of 10 words and paragraphs of 5 sentences. */
export function longText(words: number): string {
  const all = Array.from({ length: words }, (_, i) => `w${i}`)
  const sentences: string[] = []
  for (let i = 0; i < all.length; i += 10) sentences.push(`${all.slice(i, i + 10).join(' ')}.`)
  const paragraphs: string[] = []
  for (let i = 0; i < sentences.length; i += 5) paragraphs.push(sentences.slice(i, i + 5).join(' '))
  return paragraphs.join('\n\n')
}
