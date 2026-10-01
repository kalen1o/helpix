import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/lib/markdown'

describe('renderMarkdown', () => {
  it('renders headings, lists and emphasis', () => {
    const html = renderMarkdown('# Returns\n\n- **30 days**\n- free')
    expect(html).toContain('<h1>Returns</h1>')
    expect(html).toContain('<li><strong>30 days</strong></li>')
  })

  it('strips scripts, event handlers and javascript: links from tenant content', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[click](javascript:alert(1))')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
  })

  it('strips style elements (even when not first), forms and inline styles', () => {
    const html = renderMarkdown('# Hi\n\n<style>body{display:none}</style>\n\n<form><input name="x"></form>\n\n<p style="color:red">x</p>')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('style=')
  })

  it('opens links in a new tab without an opener', () => {
    const html = renderMarkdown('[docs](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
