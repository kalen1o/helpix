export interface Product {
  id: string
  name: string
  tagline: string
  description: string
  /** CSS colours for the product art. */
  colors: { name: string; body: string; accent: string }[]
  storage: { gb: number; priceCents: number }[]
  kind: 'phone' | 'accessory'
}

// A fictional brand for the Helpix demo. No real company's names, marks or photos.
export const PRODUCTS: Product[] = [
  {
    id: 'orchard-one-pro',
    name: 'Orchard One Pro',
    tagline: 'Titanium frame. Triple camera. All-day battery.',
    description: 'Our most capable phone: a 6.3-inch display, a 48 MP triple camera and a frame that shrugs off drops.',
    colors: [
      { name: 'Graphite', body: '#2B2D31', accent: '#55595F' },
      { name: 'Glacier', body: '#C9D3DA', accent: '#EEF2F5' },
      { name: 'Desert', body: '#B49A82', accent: '#D8C4AF' },
    ],
    storage: [{ gb: 256, priceCents: 109900 }, { gb: 512, priceCents: 129900 }, { gb: 1024, priceCents: 149900 }],
    kind: 'phone',
  },
  {
    id: 'orchard-one',
    name: 'Orchard One',
    tagline: 'Everything you need, nothing you don’t.',
    description: 'A 6.1-inch display, a 48 MP dual camera and the same fast chip as last year’s Pro.',
    colors: [
      { name: 'Midnight', body: '#1F2433', accent: '#3A4260' },
      { name: 'Sage', body: '#9FB3A0', accent: '#C9D8C9' },
      { name: 'Coral', body: '#E88B78', accent: '#F4B7AA' },
    ],
    storage: [{ gb: 128, priceCents: 79900 }, { gb: 256, priceCents: 89900 }],
    kind: 'phone',
  },
  {
    id: 'orchard-mini',
    name: 'Orchard Mini',
    tagline: 'Pocket-sized. Full-sized power.',
    description: 'A 5.4-inch phone that fits one hand, with the One’s camera and chip.',
    colors: [
      { name: 'Starlight', body: '#E6DFD3', accent: '#F7F3EC' },
      { name: 'Ink', body: '#202124', accent: '#3C3D41' },
    ],
    storage: [{ gb: 128, priceCents: 59900 }, { gb: 256, priceCents: 69900 }],
    kind: 'phone',
  },
  {
    id: 'orchard-buds',
    name: 'Orchard Buds',
    tagline: 'Noise cancelling. Six-hour battery.',
    description: 'Wireless earbuds with active noise cancelling and a case that charges on any Qi pad.',
    colors: [{ name: 'Snow', body: '#F2F2F2', accent: '#FFFFFF' }],
    storage: [{ gb: 0, priceCents: 17900 }],
    kind: 'accessory',
  },
]

export const productById = (id: string): Product | undefined => PRODUCTS.find((p) => p.id === id)

export const formatPrice = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
